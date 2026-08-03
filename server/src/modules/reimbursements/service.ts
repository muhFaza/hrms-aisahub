import path from 'node:path';
import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { AuthUser } from '../../middleware/auth';
import { removeUploadedFile, uploadDir } from '../../middleware/upload';
import { assertPeriodEditable } from '../../lib/periodLock';
import { assertEmployed } from '../../lib/employmentLock';
import { emitToEmployee, emitToHr, resolveGroup } from '../notifications/emit';
import type {
  CreateReimbursementInput,
  ListReimbursementsQuery,
  ReviewReimbursementInput,
} from './schemas';

const reimbursementInclude = Prisma.validator<Prisma.ReimbursementInclude>()({
  employee: { select: { fullName: true, nickname: true } },
});

type ReimbursementRow = Prisma.ReimbursementGetPayload<{ include: typeof reimbursementInclude }>;

function serializeReimbursement(reimbursement: ReimbursementRow) {
  return {
    id: reimbursement.id,
    employeeId: reimbursement.employeeId,
    employeeName: reimbursement.employee?.fullName ?? null,
    employeeNickname: reimbursement.employee?.nickname ?? null,
    date: reimbursement.date,
    amount: Number(reimbursement.amount),
    description: reimbursement.description,
    evidenceFilePath: reimbursement.evidenceFilePath,
    status: reimbursement.status,
    reviewedById: reimbursement.reviewedById,
    reviewedAt: reimbursement.reviewedAt,
    rejectReason: reimbursement.rejectReason,
    createdAt: reimbursement.createdAt,
  };
}

function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function listReimbursements(query: ListReimbursementsQuery, actor: AuthUser) {
  const where: Prisma.ReimbursementWhereInput = {};
  if (query.status) where.status = query.status;

  if (actor.roleName === 'HR') {
    if (query.employeeId) where.employeeId = query.employeeId;
  } else {
    if (!actor.employeeId) {
      return { data: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
    where.employeeId = actor.employeeId;
  }

  const [rows, total] = await Promise.all([
    prisma.reimbursement.findMany({
      where,
      include: reimbursementInclude,
      // Pending first, then most recent date.
      orderBy: [{ status: 'asc' }, { date: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.reimbursement.count({ where }),
  ]);

  return {
    data: rows.map(serializeReimbursement),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createReimbursement(
  actor: AuthUser,
  input: CreateReimbursementInput,
  evidenceFilename: string,
) {
  if (!actor.employeeId) {
    throw new HttpError(400, 'No employee profile is linked to this account');
  }
  const employeeId = actor.employeeId;

  const date = toUtcDate(input.date);
  // One transaction: the claim and the HR notifications land together or not at all.
  const created = await prisma.$transaction(async (tx) => {
    await assertPeriodEditable(date, tx);
    await assertEmployed(employeeId, date, tx);

    const reimbursement = await tx.reimbursement.create({
      data: {
        employeeId,
        date,
        amount: input.amount,
        description: input.description,
        evidenceFilePath: evidenceFilename,
      },
      include: reimbursementInclude,
    });

    await emitToHr(tx, {
      type: 'REIMBURSEMENT_SUBMITTED',
      entityType: 'REIMBURSEMENT',
      entityId: reimbursement.id,
      payload: {
        employeeName: reimbursement.employee?.fullName ?? null,
        // The model calls it description; the notification payload calls it title.
        title: reimbursement.description,
        amount: Number(reimbursement.amount),
      },
    });

    return reimbursement;
  });
  return serializeReimbursement(created);
}

export async function reviewReimbursement(
  id: number,
  reviewerUserId: number,
  input: ReviewReimbursementInput,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const reimbursement = await tx.reimbursement.findUnique({ where: { id } });
    if (!reimbursement) {
      throw new HttpError(404, 'Reimbursement not found');
    }
    if (reimbursement.status !== 'PENDING') {
      throw new HttpError(409, 'This reimbursement was already reviewed by someone else');
    }
    await assertPeriodEditable(reimbursement.date, tx);

    // Conditional transition: `status: 'PENDING'` in the WHERE is what makes two
    // reviewers racing each other resolve to exactly one winner. See reviewLeave.
    const claimed = await tx.reimbursement.updateMany({
      where: { id, status: 'PENDING' },
      data:
        input.action === 'APPROVE'
          ? { status: 'APPROVED', reviewedById: reviewerUserId, reviewedAt: new Date() }
          : {
              status: 'REJECTED',
              reviewedById: reviewerUserId,
              reviewedAt: new Date(),
              rejectReason: input.rejectReason ?? null,
            },
    });
    if (claimed.count === 0) {
      throw new HttpError(409, 'This reimbursement was already reviewed by someone else');
    }

    const decided = await tx.reimbursement.findUniqueOrThrow({
      where: { id },
      include: reimbursementInclude,
    });

    // The claim is no longer pending, so every HR copy of it stops asking to be acted on.
    await resolveGroup(tx, 'REIMBURSEMENT', id, reviewerUserId);

    await emitToEmployee(tx, decided.employeeId, {
      type: 'REIMBURSEMENT_DECIDED',
      entityType: 'REIMBURSEMENT',
      entityId: decided.id,
      payload: {
        status: decided.status,
        title: decided.description,
        amount: Number(decided.amount),
        rejectReason: decided.rejectReason,
      },
    });

    return decided;
  });
  return serializeReimbursement(updated);
}

export async function cancelReimbursement(id: number, actor: AuthUser) {
  const evidenceFilePath = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Reimbursement" WHERE id = ${id} FOR UPDATE`;
    const reimbursement = await tx.reimbursement.findUnique({
      where: { id },
      include: reimbursementInclude,
    });
    if (!reimbursement) {
      throw new HttpError(404, 'Reimbursement not found');
    }
    if (reimbursement.employeeId !== actor.employeeId) {
      throw new HttpError(403, 'You can only cancel your own reimbursements');
    }
    if (reimbursement.status !== 'PENDING') {
      throw new HttpError(400, 'Only pending reimbursements can be cancelled');
    }
    await assertPeriodEditable(reimbursement.date, tx);

    const resolved = await resolveGroup(tx, 'REIMBURSEMENT', id, actor.userId);
    await tx.reimbursement.delete({ where: { id } });

    // Only worth telling HR about a claim they were actually shown.
    if (resolved > 0) {
      await emitToHr(tx, {
        type: 'REQUEST_CANCELLED',
        entityType: 'REIMBURSEMENT',
        entityId: id,
        payload: { employeeName: reimbursement.employee?.fullName ?? null, kind: 'REIMBURSEMENT' },
      });
    }
    return reimbursement.evidenceFilePath;
  });

  // Only once the row is gone for good — the file is not recoverable.
  removeUploadedFile(evidenceFilePath);
}

// Resolves the on-disk evidence path for download; only HR or the owner may access it.
export async function getEvidencePath(id: number, actor: AuthUser): Promise<string> {
  const reimbursement = await prisma.reimbursement.findUnique({ where: { id } });
  if (!reimbursement) {
    throw new HttpError(404, 'Reimbursement not found');
  }
  if (actor.roleName !== 'HR' && reimbursement.employeeId !== actor.employeeId) {
    throw new HttpError(403, 'You can only access your own reimbursement evidence');
  }
  if (!reimbursement.evidenceFilePath) {
    throw new HttpError(404, 'No evidence file on record');
  }
  // basename guards against path traversal from a stored value.
  const filePath = path.join(uploadDir, path.basename(reimbursement.evidenceFilePath));
  if (!fs.existsSync(filePath)) {
    throw new HttpError(404, 'Evidence file is missing on disk');
  }
  return filePath;
}
