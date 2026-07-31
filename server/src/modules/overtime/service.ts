import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { AuthUser } from '../../middleware/auth';
import { assertPeriodEditable } from '../../lib/periodLock';
import { emitToEmployee, emitToHr, resolveGroup } from '../notifications/emit';
import type { CreateOvertimeInput, ListOvertimeQuery, ReviewOvertimeInput } from './schemas';

const overtimeInclude = Prisma.validator<Prisma.OvertimeInclude>()({
  employee: { select: { fullName: true, nickname: true } },
});

type OvertimeRow = Prisma.OvertimeGetPayload<{ include: typeof overtimeInclude }>;

function serializeOvertime(overtime: OvertimeRow) {
  return {
    id: overtime.id,
    employeeId: overtime.employeeId,
    employeeName: overtime.employee?.fullName ?? null,
    employeeNickname: overtime.employee?.nickname ?? null,
    date: overtime.date,
    hours: Number(overtime.hours),
    description: overtime.description,
    status: overtime.status,
    reviewedById: overtime.reviewedById,
    reviewedAt: overtime.reviewedAt,
    rejectReason: overtime.rejectReason,
    createdAt: overtime.createdAt,
  };
}

function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Notification payloads carry calendar days as ISO date strings.
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function listOvertime(query: ListOvertimeQuery, actor: AuthUser) {
  const where: Prisma.OvertimeWhereInput = {};
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
    prisma.overtime.findMany({
      where,
      include: overtimeInclude,
      // Pending first, then most recent date.
      orderBy: [{ status: 'asc' }, { date: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.overtime.count({ where }),
  ]);

  return { data: rows.map(serializeOvertime), total, page: query.page, pageSize: query.pageSize };
}

export async function createOvertime(actor: AuthUser, input: CreateOvertimeInput) {
  if (!actor.employeeId) {
    throw new HttpError(400, 'No employee profile is linked to this account');
  }
  const employee = await prisma.employee.findUnique({ where: { id: actor.employeeId } });
  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }
  if (employee.employmentType !== 'FULL_TIME') {
    throw new HttpError(403, 'Overtime is only available to full-time employees');
  }

  const date = toUtcDate(input.date);
  await assertPeriodEditable(date);

  // At most one pending/approved overtime entry per employee per date.
  const existing = await prisma.overtime.findFirst({
    where: { employeeId: employee.id, date, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (existing) {
    throw new HttpError(409, 'An overtime entry already exists for this date');
  }

  // One transaction: the entry and the HR notifications land together or not at all.
  const created = await prisma.$transaction(async (tx) => {
    const overtime = await tx.overtime.create({
      data: {
        employeeId: employee.id,
        date,
        hours: input.hours,
        description: input.description,
      },
      include: overtimeInclude,
    });

    await emitToHr(tx, {
      type: 'OVERTIME_SUBMITTED',
      entityType: 'OVERTIME',
      entityId: overtime.id,
      payload: {
        employeeName: employee.fullName,
        date: isoDate(overtime.date),
        hours: Number(overtime.hours),
      },
    });

    return overtime;
  });
  return serializeOvertime(created);
}

export async function reviewOvertime(id: number, reviewerUserId: number, input: ReviewOvertimeInput) {
  const overtime = await prisma.overtime.findUnique({ where: { id } });
  if (!overtime) {
    throw new HttpError(404, 'Overtime entry not found');
  }
  if (overtime.status !== 'PENDING') {
    throw new HttpError(400, 'Only pending overtime entries can be reviewed');
  }
  await assertPeriodEditable(overtime.date);

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional transition: `status: 'PENDING'` in the WHERE is what makes two
    // reviewers racing each other resolve to exactly one winner. See reviewLeave.
    const claimed = await tx.overtime.updateMany({
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
      throw new HttpError(409, 'This overtime entry was already reviewed by someone else');
    }

    const decided = await tx.overtime.findUniqueOrThrow({
      where: { id },
      include: overtimeInclude,
    });

    // The entry is no longer pending, so every HR copy of it stops asking to be acted on.
    await resolveGroup(tx, 'OVERTIME', id, reviewerUserId);

    await emitToEmployee(tx, decided.employeeId, {
      type: 'OVERTIME_DECIDED',
      entityType: 'OVERTIME',
      entityId: decided.id,
      payload: {
        status: decided.status,
        date: isoDate(decided.date),
        hours: Number(decided.hours),
        rejectReason: decided.rejectReason,
      },
    });

    return decided;
  });
  return serializeOvertime(updated);
}

export async function cancelOvertime(id: number, actor: AuthUser) {
  const overtime = await prisma.overtime.findUnique({ where: { id }, include: overtimeInclude });
  if (!overtime) {
    throw new HttpError(404, 'Overtime entry not found');
  }
  if (overtime.employeeId !== actor.employeeId) {
    throw new HttpError(403, 'You can only cancel your own overtime entries');
  }
  if (overtime.status !== 'PENDING') {
    throw new HttpError(400, 'Only pending overtime entries can be cancelled');
  }
  await assertPeriodEditable(overtime.date);

  await prisma.$transaction(async (tx) => {
    const resolved = await resolveGroup(tx, 'OVERTIME', id, actor.userId);
    await tx.overtime.delete({ where: { id } });

    // Only worth telling HR about an entry they were actually shown.
    if (resolved > 0) {
      await emitToHr(tx, {
        type: 'REQUEST_CANCELLED',
        entityType: 'OVERTIME',
        entityId: id,
        payload: { employeeName: overtime.employee?.fullName ?? null, kind: 'OVERTIME' },
      });
    }
  });
}
