import { describe, expect, it } from 'vitest';
import { computeBalance, isExpired, planFifoAllocation, type AccrualLike } from '../accrual';

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const NOW = d('2026-07-08');

describe('isExpired', () => {
  it('is true at/before now and false afterwards', () => {
    expect(isExpired(d('2026-07-01'), NOW)).toBe(true);
    expect(isExpired(d('2026-08-01'), NOW)).toBe(false);
  });
});

describe('computeBalance', () => {
  it('excludes expired rows from the balance and tallies them separately', () => {
    const rows: AccrualLike[] = [
      { id: 1, days: 1, daysConsumed: 0, expiresAt: d('2026-06-01') }, // expired, unused
      { id: 2, days: 1, daysConsumed: 0, expiresAt: d('2026-08-01') }, // active
      { id: 3, days: 1, daysConsumed: 1, expiresAt: d('2026-09-01') }, // active, fully used
      { id: 4, days: 1, daysConsumed: 0, expiresAt: d('2026-10-01') }, // active
    ];
    const totals = computeBalance(rows, NOW);
    expect(totals.balance).toBe(2); // rows 2 and 4
    expect(totals.accruedTotal).toBe(4);
    expect(totals.usedTotal).toBe(1);
    expect(totals.expiredTotal).toBe(1); // row 1's unused remainder
  });
});

describe('planFifoAllocation', () => {
  const rows: AccrualLike[] = [
    { id: 30, days: 1, daysConsumed: 0, expiresAt: d('2026-10-01') },
    { id: 10, days: 1, daysConsumed: 0, expiresAt: d('2026-08-01') },
    { id: 20, days: 1, daysConsumed: 0, expiresAt: d('2026-09-01') },
  ];

  it('allocates oldest-expiring first regardless of input order', () => {
    expect(planFifoAllocation(rows, 1)).toEqual([{ id: 10, take: 1 }]);
  });

  it('spreads an allocation across multiple rows in FIFO order', () => {
    expect(planFifoAllocation(rows, 2.5)).toEqual([
      { id: 10, take: 1 },
      { id: 20, take: 1 },
      { id: 30, take: 0.5 },
    ]);
  });

  it('throws when the rows cannot cover the request (over-allocation guard)', () => {
    expect(() => planFifoAllocation(rows, 4)).toThrow(/Insufficient leave balance/);
  });
});
