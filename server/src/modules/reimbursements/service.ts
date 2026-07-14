import path from 'node:path';
import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { AuthUser } from '../../middleware/auth';
import { uploadDir } from '../../middleware/upload';
import { assertPeriodEditable } from '../../lib/periodLock';
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

// Removes the stored evidence file from disk; missing files are ignored.
function unlinkEvidence(filename: string | null): void {
  if (!filename) return;
  const filePath = path.join(uploadDir, path.basename(filename));
  fs.rm(filePath, { force: true }, () => undefined);
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

  const date = toUtcDate(input.date);
  await assertPeriodEditable(date);

  const created = await prisma.reimbursement.create({
    data: {
      employeeId: actor.employeeId,
      date,
      amount: input.amount,
      description: input.description,
      evidenceFilePath: evidenceFilename,
    },
    include: reimbursementInclude,
  });
  return serializeReimbursement(created);
}

export async function reviewReimbursement(
  id: number,
  reviewerUserId: number,
  input: ReviewReimbursementInput,
) {
  const reimbursement = await prisma.reimbursement.findUnique({ where: { id } });
  if (!reimbursement) {
    throw new HttpError(404, 'Reimbursement not found');
  }
  if (reimbursement.status !== 'PENDING') {
    throw new HttpError(400, 'Only pending reimbursements can be reviewed');
  }
  await assertPeriodEditable(reimbursement.date);

  const updated = await prisma.reimbursement.update({
    where: { id },
    data:
      input.action === 'APPROVE'
        ? { status: 'APPROVED', reviewedById: reviewerUserId, reviewedAt: new Date() }
        : {
            status: 'REJECTED',
            reviewedById: reviewerUserId,
            reviewedAt: new Date(),
            rejectReason: input.rejectReason ?? null,
          },
    include: reimbursementInclude,
  });
  return serializeReimbursement(updated);
}

export async function cancelReimbursement(id: number, actor: AuthUser) {
  const reimbursement = await prisma.reimbursement.findUnique({ where: { id } });
  if (!reimbursement) {
    throw new HttpError(404, 'Reimbursement not found');
  }
  if (reimbursement.employeeId !== actor.employeeId) {
    throw new HttpError(403, 'You can only cancel your own reimbursements');
  }
  if (reimbursement.status !== 'PENDING') {
    throw new HttpError(400, 'Only pending reimbursements can be cancelled');
  }
  await assertPeriodEditable(reimbursement.date);
  await prisma.reimbursement.delete({ where: { id } });
  unlinkEvidence(reimbursement.evidenceFilePath);
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
