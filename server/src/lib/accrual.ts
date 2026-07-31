import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { prisma } from '../config/prisma';
import { HttpError } from './httpError';

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

// Idempotent catch-up: creates any missing monthly accrual rows for active full-timers
// from their join month through the current month. One paid-leave day per completed month
// of service, each expiring 18 months after its accrual period (design §4). Returns rows created.
export async function ensureAccrualsUpToDate(employeeId?: number): Promise<number> {
  const employees = await prisma.employee.findMany({
    where: {
      employmentType: 'FULL_TIME',
      isActive: true,
      ...(employeeId ? { id: employeeId } : {}),
    },
    select: { id: true, joinDate: true },
  });

  const currentMonth = dayjs().startOf('month');
  let created = 0;

  for (const employee of employees) {
    const existing = await prisma.leaveAccrual.findMany({
      where: { employeeId: employee.id },
      select: { period: true },
    });
    const existingKeys = new Set(existing.map((row) => row.period.toISOString().slice(0, 10)));

    const toCreate: Prisma.LeaveAccrualCreateManyInput[] = [];
    let cursor = dayjs(employee.joinDate).startOf('month');
    while (cursor.isSame(currentMonth) || cursor.isBefore(currentMonth)) {
      const key = cursor.format('YYYY-MM-DD');
      if (!existingKeys.has(key)) {
        toCreate.push({
          employeeId: employee.id,
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
  expiringSoon: { days: number; expiresAt: Date }[];
  rows: AccrualRowBreakdown[];
}

// Balance = Σ over non-expired rows of (days − daysConsumed); non-expired means expiresAt > now.
// Identity: accruedTotal = usedTotal + expiredTotal (unused expired) + balance.
export async function getBalanceBreakdown(employeeId: number): Promise<BalanceBreakdown> {
  const now = new Date();
  const soonCutoff = dayjs(now).add(60, 'day').toDate();

  const accruals = await prisma.leaveAccrual.findMany({
    where: { employeeId },
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

  const sick = await prisma.leaveRequest.aggregate({
    where: { employeeId, type: 'SICK' },
    _sum: { totalDays: true },
  });

  return {
    balance,
    accruedTotal,
    usedTotal,
    expiredTotal,
    sickTaken: Number(sick._sum.totalDays ?? 0),
    expiringSoon,
    rows,
  };
}
