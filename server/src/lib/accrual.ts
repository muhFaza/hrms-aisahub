import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { prisma } from '../config/prisma';
import { HttpError } from './httpError';
import { accrualCutoffMonth, currentlyEmployedFilter } from './employment';

// UTC-midnight Date from a 'YYYY-MM-DD' key — matches how periods are seeded (design §3).
function utcMidnight(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

// --- Pure accrual math (DB-free, unit-tested in Phase 6). ---

export interface AccrualLike {
  id: number;
  days: number;
  daysConsumed: number;
  expiresAt: Date;
}

export interface BalanceTotals {
  balance: number;
  accruedTotal: number;
  usedTotal: number;
  expiredTotal: number;
}

export interface AllocationStep {
  id: number;
  take: number;
}

// A row is expired once its expiry instant is reached (design §4 uses expiresAt <= now).
export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt <= now;
}

// Balance = Σ non-expired (days − daysConsumed). accruedTotal/usedTotal count every row;
// expiredTotal holds the unused remainder of already-expired rows (design §4).
export function computeBalance(rows: AccrualLike[], now: Date): BalanceTotals {
  let balance = 0;
  let accruedTotal = 0;
  let usedTotal = 0;
  let expiredTotal = 0;
  for (const row of rows) {
    const remaining = row.days - row.daysConsumed;
    accruedTotal += row.days;
    usedTotal += row.daysConsumed;
    if (isExpired(row.expiresAt, now)) {
      expiredTotal += remaining;
    } else {
      balance += remaining;
    }
  }
  return { balance, accruedTotal, usedTotal, expiredTotal };
}

// FIFO allocation plan: consume `totalDays` from the given rows, oldest-expiring first,
// taking min(available, remaining) per row. Throws when the rows cannot cover the request
// (over-allocation guard). Callers apply the returned steps inside a transaction.
export function planFifoAllocation(rows: AccrualLike[], totalDays: number): AllocationStep[] {
  const ordered = [...rows].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const plan: AllocationStep[] = [];
  let remaining = totalDays;
  for (const row of ordered) {
    if (remaining <= 0) break;
    const available = row.days - row.daysConsumed;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    plan.push({ id: row.id, take });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new HttpError(400, 'Insufficient leave balance to approve this request');
  }
  return plan;
}

// Idempotent catch-up: creates any missing monthly accrual rows for full-timers in a current
// employment, from that employment's fullTimeSince month through the current month (or the
// termination month, for somebody serving notice). One
// paid-leave day per completed month of service, each expiring 18 months after its accrual
// period (design §4). Returns rows created.
//
// The cursor starts at fullTimeSince, not startDate: a part-timer later promoted to
// full-time earns paid leave from the promotion, never retroactively for the months they
// were part-time. fullTimeSince is NULL for part-timers, so the guard below also stops
// accrual for anyone converted out of full-time.
//
// Rows are scoped to the employment, and only CURRENT employments are considered (open, or
// serving out a notice period). That is what makes a rehire start from zero: the new employment has its own fullTimeSince and its own
// accrual rows, so the cursor cannot walk back across the gap and mint a day for every month
// the person was not employed. Before Employment existed, reactivating a long-departed
// employee granted them a leave day for every month they had been away.
export async function ensureAccrualsUpToDate(employeeId?: number): Promise<number> {
  // "Currently employed" means open OR serving notice — NOT simply `endDate: null`.
  //
  // A termination dated in the future leaves somebody active and working, and they go on
  // earning leave for every month they actually work. Filtering on `endDate: null` alone made
  // the employment invisible the instant the notice was recorded, quietly costing an employee
  // one day per month of their notice period.
  const employments = await prisma.employment.findMany({
    where: {
      ...currentlyEmployedFilter(),
      fullTimeSince: { not: null },
      employee: {
        employmentType: 'FULL_TIME',
        ...(employeeId ? { id: employeeId } : {}),
      },
    },
    select: { id: true, employeeId: true, fullTimeSince: true, endDate: true },
  });

  const currentMonth = dayjs().startOf('month');
  let created = 0;

  for (const employment of employments) {
    const existing = await prisma.leaveAccrual.findMany({
      where: { employmentId: employment.id },
      select: { period: true },
    });
    const existingKeys = new Set(existing.map((row) => row.period.toISOString().slice(0, 10)));

    const toCreate: Prisma.LeaveAccrualCreateManyInput[] = [];
    // Month granularity, matching the existing rule that someone joining on the 30th earns
    // that month's full day: converting mid-month earns the conversion month's day.
    // Stop at the termination month for somebody serving notice — they earn the months they
    // work, not the ones after they leave. Open employments run to the current month.
    const cutoff = accrualCutoffMonth(employment);
    const lastMonth =
      cutoff && dayjs(cutoff).isBefore(currentMonth) ? dayjs(cutoff) : currentMonth;

    let cursor = dayjs(employment.fullTimeSince as Date).startOf('month');
    while (cursor.isSame(lastMonth) || cursor.isBefore(lastMonth)) {
      const key = cursor.format('YYYY-MM-DD');
      if (!existingKeys.has(key)) {
        toCreate.push({
          employeeId: employment.employeeId,
          employmentId: employment.id,
          period: utcMidnight(key),
          days: 1,
          daysConsumed: 0,
          expiresAt: utcMidnight(cursor.add(18, 'month').format('YYYY-MM-DD')),
        });
      }
      cursor = cursor.add(1, 'month');
    }

    if (toCreate.length > 0) {
      await prisma.leaveAccrual.createMany({ data: toCreate, skipDuplicates: true });
      created += toCreate.length;
    }
  }

  return created;
}

export interface AccrualRowBreakdown {
  id: number;
  period: Date;
  days: number;
  daysConsumed: number;
  remaining: number;
  expiresAt: Date;
  expired: boolean;
}

export interface BalanceBreakdown {
  balance: number;
  accruedTotal: number;
  usedTotal: number;
  expiredTotal: number;
  sickTaken: number;
  unpaidTaken: number;
  expiringSoon: { days: number; expiresAt: Date }[];
  rows: AccrualRowBreakdown[];
}

// Balance = Σ over non-expired rows of (days − daysConsumed); non-expired means expiresAt > now.
// Identity: accruedTotal = usedTotal + expiredTotal (unused expired) + balance.
export async function getBalanceBreakdown(employeeId: number): Promise<BalanceBreakdown> {
  const now = new Date();
  const soonCutoff = dayjs(now).add(60, 'day').toDate();

  // Everything below is scoped to one employment — the open one, or the most recent if the
  // employee has left. A rehired employee's balance is their new engagement's, not a running
  // total across both.
  const employment = await prisma.employment.findFirst({
    where: { employeeId },
    orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { startDate: 'desc' }],
    select: { id: true, startDate: true, endDate: true },
  });

  // No employment means corrupt data — the backfill gave every employee one. Report an empty
  // balance rather than falling back to every accrual the employee has ever had.
  if (!employment) {
    return {
      balance: 0,
      accruedTotal: 0,
      usedTotal: 0,
      expiredTotal: 0,
      sickTaken: 0,
      unpaidTaken: 0,
      expiringSoon: [],
      rows: [],
    };
  }

  const accruals = await prisma.leaveAccrual.findMany({
    where: { employmentId: employment.id },
    orderBy: [{ expiresAt: 'asc' }, { period: 'asc' }],
  });

  const expiringSoon: { days: number; expiresAt: Date }[] = [];

  const rows: AccrualRowBreakdown[] = accruals.map((accrual) => {
    const days = Number(accrual.days);
    const daysConsumed = Number(accrual.daysConsumed);
    const remaining = days - daysConsumed;
    const expired = isExpired(accrual.expiresAt, now);

    if (!expired && remaining > 0 && accrual.expiresAt <= soonCutoff) {
      expiringSoon.push({ days: remaining, expiresAt: accrual.expiresAt });
    }

    return { id: accrual.id, period: accrual.period, days, daysConsumed, remaining, expiresAt: accrual.expiresAt, expired };
  });

  const { balance, accruedTotal, usedTotal, expiredTotal } = computeBalance(rows, now);

  // Totals per deducting type for THIS employment, not per-year and not across a rehire. One
  // groupBy rather than an aggregate per type; a type with no records is simply absent.
  const taken = await prisma.leaveRequest.groupBy({
    by: ['type'],
    where: {
      employeeId,
      type: { in: ['SICK', 'UNPAID'] },
      startDate: {
        gte: employment.startDate,
        ...(employment.endDate ? { lte: employment.endDate } : {}),
      },
    },
    _sum: { totalDays: true },
  });
  const takenByType = (type: 'SICK' | 'UNPAID') =>
    Number(taken.find((row) => row.type === type)?._sum.totalDays ?? 0);

  return {
    balance,
    accruedTotal,
    usedTotal,
    expiredTotal,
    sickTaken: takenByType('SICK'),
    unpaidTaken: takenByType('UNPAID'),
    expiringSoon,
    rows,
  };
}
