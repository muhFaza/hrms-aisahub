import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { AuthUser } from '../../middleware/auth';
import { countWorkingDays } from '../../lib/workingDays';
import { ensureAccrualsUpToDate, getBalanceBreakdown, planFifoAllocation } from '../../lib/accrual';
import { assertPeriodEditable } from '../../lib/periodLock';
import { sendLeaveDecisionEmail, sendLeaveSubmittedEmail } from '../../lib/email';
import type { CreateLeaveInput, ListLeaveQuery, ReviewLeaveInput } from './schemas';

const requestInclude = Prisma.validator<Prisma.LeaveRequestInclude>()({
  employee: { select: { fullName: true, nickname: true, email: true } },
});

type RequestRow = Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>;

function serializeRequest(request: RequestRow) {
  return {
    id: request.id,
    employeeId: request.employeeId,
    employeeName: request.employee?.fullName ?? null,
    employeeNickname: request.employee?.nickname ?? null,
    type: request.type,
    startDate: request.startDate,
    endDate: request.endDate,
    totalDays: Number(request.totalDays),
    reason: request.reason,
    status: request.status,
    reviewedById: request.reviewedById,
    reviewedAt: request.reviewedAt,
    rejectReason: request.rejectReason,
    createdAt: request.createdAt,
  };
}

// Normalize to UTC midnight so working-day counting and holiday keys line up.
function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function listLeave(query: ListLeaveQuery, actor: AuthUser) {
  const where: Prisma.LeaveRequestWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;

  if (actor.roleName === 'HR') {
    if (query.employeeId) where.employeeId = query.employeeId;
  } else {
    // Employees only ever see their own requests, ignoring any employeeId filter.
    if (!actor.employeeId) {
      return { data: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
    where.employeeId = actor.employeeId;
  }

  const [rows, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.leaveRequest.count({ where }),
  ]);

  return { data: rows.map(serializeRequest), total, page: query.page, pageSize: query.pageSize };
}

export async function submitLeave(actor: AuthUser, input: CreateLeaveInput) {
  if (!actor.employeeId) {
    throw new HttpError(400, 'No employee profile is linked to this account');
  }
  const employee = await prisma.employee.findUnique({ where: { id: actor.employeeId } });
  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }

  const startDate = toUtcDate(input.startDate);
  const endDate = toUtcDate(input.endDate);

  if (input.type === 'PAID' && employee.employmentType !== 'FULL_TIME') {
    throw new HttpError(400, 'Paid leave is only available to full-time employees');
  }

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    select: { date: true },
  });
  const holidayKeys = holidays.map((holiday) => holiday.date.toISOString().slice(0, 10));
  const totalDays = countWorkingDays(startDate, endDate, holidayKeys);

  if (totalDays <= 0) {
    throw new HttpError(400, 'The selected range has no working days (weekends and holidays are excluded)');
  }

  // An employee cannot double-book overlapping PENDING/APPROVED requests.
  const overlap = await prisma.leaveRequest.findFirst({
    where: {
      employeeId: employee.id,
      status: { in: ['PENDING', 'APPROVED'] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
  });
  if (overlap) {
    throw new HttpError(400, 'This date range overlaps an existing pending or approved request');
  }

  if (input.type === 'PAID') {
    await ensureAccrualsUpToDate(employee.id);
    const { balance } = await getBalanceBreakdown(employee.id);
    if (balance < totalDays) {
      throw new HttpError(
        400,
        `Insufficient leave balance: requested ${totalDays} day(s) but only ${balance} available`,
      );
    }
  }

  const created = await prisma.leaveRequest.create({
    data: {
      employeeId: employee.id,
      type: input.type,
      startDate,
      endDate,
      totalDays,
      reason: input.reason ?? null,
    },
    include: requestInclude,
  });

  // Fire-and-forget HR notification; failures are caught inside the email helper.
  void sendLeaveSubmittedEmail({
    employeeName: employee.fullName,
    type: created.type,
    startDate: created.startDate,
    endDate: created.endDate,
    totalDays: Number(created.totalDays),
    reason: created.reason,
  });

  return serializeRequest(created);
}

// FIFO consumption across non-expired rows, oldest-expiring first (design §4).
async function consumePaidLeave(
  tx: Prisma.TransactionClient,
  employeeId: number,
  totalDays: number,
): Promise<void> {
  const now = new Date();
  const accruals = await tx.leaveAccrual.findMany({
    where: { employeeId, expiresAt: { gt: now } },
    orderBy: [{ expiresAt: 'asc' }, { period: 'asc' }],
  });

  const plan = planFifoAllocation(
    accruals.map((accrual) => ({
      id: accrual.id,
      days: Number(accrual.days),
      daysConsumed: Number(accrual.daysConsumed),
      expiresAt: accrual.expiresAt,
    })),
    totalDays,
  );

  const daysById = new Map(accruals.map((accrual) => [accrual.id, Number(accrual.days)]));

  for (const step of plan) {
    // Conditional increment guards against a concurrent approval consuming the same row (TOCTOU):
    // only apply when the row still has room for `take`; the CHECK constraint is the final backstop.
    const capacity = (daysById.get(step.id) ?? 0) - step.take;
    const result = await tx.leaveAccrual.updateMany({
      where: { id: step.id, daysConsumed: { lte: capacity } },
      data: { daysConsumed: { increment: step.take } },
    });
    if (result.count !== 1) {
      throw new HttpError(409, 'Leave balance changed, please retry');
    }
  }
}

export async function reviewLeave(id: number, reviewerUserId: number, input: ReviewLeaveInput) {
  const request = await prisma.leaveRequest.findUnique({
    where: { id },
    include: requestInclude,
  });
  if (!request) {
    throw new HttpError(404, 'Leave request not found');
  }
  if (request.status !== 'PENDING') {
    throw new HttpError(400, 'Only pending requests can be reviewed');
  }
  // Reviewing affects the leave's start month; block if that period is finalized.
  await assertPeriodEditable(request.startDate);

  const reviewedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    if (input.action === 'APPROVE') {
      if (request.type === 'PAID') {
        await consumePaidLeave(tx, request.employeeId, Number(request.totalDays));
      }
      return tx.leaveRequest.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: reviewerUserId, reviewedAt },
        include: requestInclude,
      });
    }
    return tx.leaveRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: reviewerUserId,
        reviewedAt,
        rejectReason: input.rejectReason ?? null,
      },
      include: requestInclude,
    });
  });

  if (updated.employee?.email) {
    void sendLeaveDecisionEmail(updated.employee.email, updated.status as 'APPROVED' | 'REJECTED', {
      employeeName: updated.employee.fullName,
      type: updated.type,
      startDate: updated.startDate,
      endDate: updated.endDate,
      totalDays: Number(updated.totalDays),
      reason: updated.reason,
      rejectReason: updated.rejectReason,
    });
  }

  return serializeRequest(updated);
}

export async function cancelLeave(id: number, actor: AuthUser) {
  const request = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!request) {
    throw new HttpError(404, 'Leave request not found');
  }
  if (actor.roleName !== 'HR' && request.employeeId !== actor.employeeId) {
    throw new HttpError(403, 'You can only cancel your own requests');
  }
  if (request.status !== 'PENDING') {
    throw new HttpError(400, 'Only pending requests can be cancelled');
  }
  await assertPeriodEditable(request.startDate);
  await prisma.leaveRequest.delete({ where: { id } });
}

export async function getBalance(employeeId: number) {
  await ensureAccrualsUpToDate(employeeId);
  return getBalanceBreakdown(employeeId);
}

export async function getBalances() {
  await ensureAccrualsUpToDate();
  const employees = await prisma.employee.findMany({
    where: { employmentType: 'FULL_TIME', isActive: true },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, nickname: true },
  });

  const rows = [];
  for (const employee of employees) {
    const breakdown = await getBalanceBreakdown(employee.id);
    rows.push({
      employeeId: employee.id,
      employeeName: employee.fullName,
      nickname: employee.nickname,
      balance: breakdown.balance,
      accrued: breakdown.accruedTotal,
      used: breakdown.usedTotal,
      expired: breakdown.expiredTotal,
      sickTaken: breakdown.sickTaken,
    });
  }
  return rows;
}

export async function getCalendar(month: string) {
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const monthEnd = dayjs(monthStart).endOf('month').toDate();

  const [leaves, holidays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      include: { employee: { select: { fullName: true, nickname: true } } },
      orderBy: { startDate: 'asc' },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
      orderBy: { date: 'asc' },
    }),
  ]);

  return {
    leaves: leaves.map((leave) => ({
      id: leave.id,
      employeeName: leave.employee?.fullName ?? '',
      employeeNickname: leave.employee?.nickname ?? null,
      type: leave.type,
      startDate: leave.startDate,
      endDate: leave.endDate,
    })),
    holidays,
  };
}
