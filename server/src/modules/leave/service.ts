import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { AuthUser } from '../../middleware/auth';
import { countWorkingDays, offDayHolidayKeys } from '../../lib/workingDays';
import { ensureAccrualsUpToDate, getBalanceBreakdown, planFifoAllocation } from '../../lib/accrual';
import { assertPeriodEditable } from '../../lib/periodLock';
import { currentlyEmployedFilter } from '../../lib/employment';
import { emitToHr, resolveGroup } from '../notifications/emit';
import type { CreateLeaveInput, ListLeaveQuery } from './schemas';

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
    createdAt: request.createdAt,
  };
}

// Normalize to UTC midnight so working-day counting and holiday keys line up.
function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Notification payloads carry calendar days as ISO date strings.
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function listLeave(query: ListLeaveQuery, actor: AuthUser) {
  const where: Prisma.LeaveRequestWhereInput = {};
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

  // The current employment is both the terminated guard and the accrual scope.
  // Open OR serving notice — the same definition assertEmployed uses for overtime,
  // reimbursements and daily logs. Requiring `endDate: null` here made leave the one thing an
  // employee on notice could not file, while every other submission still worked.
  const employment = await prisma.employment.findFirst({
    where: { employeeId: employee.id, ...currentlyEmployedFilter() },
    orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { startDate: 'desc' }],
    select: { id: true },
  });
  if (!employment) {
    throw new HttpError(400, 'This employee is not currently employed');
  }

  const startDate = toUtcDate(input.startDate);
  const endDate = toUtcDate(input.endDate);

  // Leave is a full-time benefit outright, not just paid leave. Part-timers are paid per
  // logged hour, so an unlogged day is already unpaid and there is nothing to record.
  // cancelLeave is deliberately NOT gated this way: HR must still be able to unwind a
  // historical record belonging to someone who has since converted to part-time.
  if (employee.employmentType !== 'FULL_TIME') {
    throw new HttpError(400, 'Leave is only available to full-time employees');
  }

  // `type` decides whether the day is worked: joint leave (cuti bersama) is a working day, so
  // leave taken across it does consume those days.
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    select: { date: true, type: true },
  });
  const totalDays = countWorkingDays(startDate, endDate, offDayHolidayKeys(holidays));

  if (totalDays <= 0) {
    throw new HttpError(
      400,
      'The selected range has no working days (weekends and public holidays are excluded)',
    );
  }

  if (input.type === 'PAID') {
    await ensureAccrualsUpToDate(employee.id);
  }

  // The overlap check, the balance guard, the consumption, the create and the HR
  // notification are one transaction: leave takes effect on submit, so nothing may come
  // between checking the balance and spending it.
  const created = await prisma.$transaction(async (tx) => {
    // Serialize this employee's submissions on their own Employee row. READ COMMITTED lets
    // two concurrent submissions both read "no overlap" and both insert, and there is no
    // exclusion constraint to catch it. Defence in depth: the conditional increment in
    // consumePaidLeave and the CHECK constraint still stand behind this.
    await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employee.id} FOR UPDATE`;

    // Every stored row is leave that is taken, so any overlap is a double-booking.
    const overlap = await tx.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlap) {
      throw new HttpError(400, 'This date range overlaps an existing leave record');
    }

    if (input.type === 'PAID') {
      const balance = await availableBalance(tx, employment.id);
      if (balance < totalDays) {
        throw new HttpError(
          400,
          `Insufficient leave balance: requested ${totalDays} day(s) but only ${balance} available`,
        );
      }
      await consumePaidLeave(tx, employment.id, totalDays);
    }

    const request = await tx.leaveRequest.create({
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

    await emitToHr(tx, {
      type: 'LEAVE_SUBMITTED',
      entityType: 'LEAVE_REQUEST',
      entityId: request.id,
      payload: {
        employeeName: employee.fullName,
        leaveType: request.type,
        startDate: isoDate(request.startDate),
        endDate: isoDate(request.endDate),
        totalDays: Number(request.totalDays),
      },
    });

    return request;
  });

  return serializeRequest(created);
}

// Remaining days on non-expired rows, read through the caller's transaction client so the
// guard and the consumption that follows it see the same snapshot.
// Scoped to one employment throughout: balance, consumption and refund all belong to the
// engagement the leave sits in, so a rehired employee cannot spend the previous one's days.
async function availableBalance(
  tx: Prisma.TransactionClient,
  employmentId: number,
): Promise<number> {
  const accruals = await tx.leaveAccrual.findMany({
    where: { employmentId, expiresAt: { gt: new Date() } },
    select: { days: true, daysConsumed: true },
  });
  return accruals.reduce(
    (sum, accrual) => sum + (Number(accrual.days) - Number(accrual.daysConsumed)),
    0,
  );
}

// FIFO consumption across non-expired rows, oldest-expiring first (design §4).
async function consumePaidLeave(
  tx: Prisma.TransactionClient,
  employmentId: number,
  totalDays: number,
): Promise<void> {
  const now = new Date();
  const accruals = await tx.leaveAccrual.findMany({
    where: { employmentId, expiresAt: { gt: now } },
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

// Refund on cancellation, unwinding where FIFO consumption actually drew from: non-expired
// rows first in FIFO order (oldest-expiring first), then expired rows in the same order.
//
// Refunding newest-first would migrate a day from a soon-expiring row to a longer-lived one
// whenever a second leave had spilled over, manufacturing usable future balance. Taking
// expired rows last means the refund only reaches them to absorb a remainder — days that
// land there are unspendable and lost, which is the accepted asymmetry: crediting a live row
// instead would silently extend an expiry date.
//
// Nothing records which rows a given leave drew from, so this is a reconstruction, not a
// replay. It is chosen to never invent spendable days.
async function refundPaidLeave(
  tx: Prisma.TransactionClient,
  employmentId: number,
  totalDays: number,
): Promise<void> {
  const now = new Date();
  const rows = await tx.leaveAccrual.findMany({
    where: { employmentId, daysConsumed: { gt: 0 } },
  });
  const byFifo = (a: { expiresAt: Date; period: Date }, b: { expiresAt: Date; period: Date }) =>
    a.expiresAt.getTime() - b.expiresAt.getTime() || a.period.getTime() - b.period.getTime();
  const accruals = [
    ...rows.filter((row) => row.expiresAt > now).sort(byFifo),
    ...rows.filter((row) => row.expiresAt <= now).sort(byFifo),
  ];

  let remaining = totalDays;
  for (const accrual of accruals) {
    if (remaining <= 0) break;
    const give = Math.min(Number(accrual.daysConsumed), remaining);
    // Conditional decrement, mirroring consumePaidLeave: only apply while the row still
    // holds `give` consumed days, so a concurrent refund cannot drive it below zero.
    const result = await tx.leaveAccrual.updateMany({
      where: { id: accrual.id, daysConsumed: { gte: give } },
      data: { daysConsumed: { decrement: give } },
    });
    if (result.count !== 1) {
      throw new HttpError(409, 'Leave balance changed, please retry');
    }
    remaining -= give;
  }
}

export async function cancelLeave(id: number, actor: AuthUser) {
  const request = await prisma.leaveRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) {
    throw new HttpError(404, 'Leave request not found');
  }
  const isHr = actor.roleName === 'HR';
  if (!isHr && request.employeeId !== actor.employeeId) {
    throw new HttpError(403, 'You can only cancel your own requests');
  }
  // Once the first day has passed the leave has been taken; only HR may unwind it, as a
  // correction. The finalized-month freeze binds HR too — payslips are already out.
  if (!isHr && toUtcDate(new Date()) > request.startDate) {
    throw new HttpError(400, 'Leave can only be cancelled up to and including its start date');
  }

  await prisma.$transaction(async (tx) => {
    // Read through the transaction: payroll must not be able to finalize the month
    // between this check and the refund it guards.
    await assertPeriodEditable(request.startDate, tx);

    const resolved = await resolveGroup(tx, 'LEAVE_REQUEST', id, actor.userId);
    if (request.type === 'PAID') {
      // Refund to the employment the leave was taken in, not simply the current one: HR can
      // unwind a historical record, and those days belong to the engagement that spent them.
      //
      // The fallback matters. Leave can predate the employment that covers it — a record
      // backdated before the start date, or imported history — and refusing to refund those
      // would leave HR unable to correct exactly the mistakes this path exists for. The
      // current employment is where the accrual rows are, so it is the right destination when
      // no employment spans the dates.
      const covering = await tx.employment.findFirst({
        where: {
          employeeId: request.employeeId,
          startDate: { lte: request.startDate },
          OR: [{ endDate: null }, { endDate: { gte: request.startDate } }],
        },
        select: { id: true },
      });
      const employment =
        covering ??
        (await tx.employment.findFirst({
          where: { employeeId: request.employeeId },
          orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { startDate: 'desc' }],
          select: { id: true },
        }));
      if (!employment) {
        throw new HttpError(409, 'Employee has no employment record');
      }
      await refundPaidLeave(tx, employment.id, Number(request.totalDays));
    }
    await tx.leaveRequest.delete({ where: { id } });

    // Only worth telling HR about a record they were actually shown. With no approval
    // step the submit notification stays unresolved until here, so this fires whenever
    // an active HR account existed when the leave was recorded.
    if (resolved > 0) {
      await emitToHr(tx, {
        type: 'REQUEST_CANCELLED',
        entityType: 'LEAVE_REQUEST',
        entityId: id,
        payload: { employeeName: request.employee?.fullName ?? null, kind: 'LEAVE' },
      });
    }
  });
}

export async function getBalance(employeeId: number) {
  await ensureAccrualsUpToDate(employeeId);
  return getBalanceBreakdown(employeeId);
}

export async function getBalances() {
  await ensureAccrualsUpToDate();
  const employees = await prisma.employee.findMany({
    // Currently employed, which includes anyone serving notice — they are still accruing,
    // so dropping them here would hide the balance HR needs to settle.
    where: {
      employmentType: 'FULL_TIME',
      employments: { some: currentlyEmployedFilter() },
    },
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
      unpaidTaken: breakdown.unpaidTaken,
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
