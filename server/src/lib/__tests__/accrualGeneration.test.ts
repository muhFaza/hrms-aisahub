import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../config/prisma';
import {
  createEmployee,
  currentEmployment,
  resetDb,
  utc,
} from '../../__tests__/helpers/factories';
import { ensureAccrualsUpToDate } from '../accrual';

// The catch-up loop runs through the current month, so "now" has to be pinned or the expected
// row counts drift as real time passes. Only Date is faked — timers stay real so Prisma's
// async I/O still resolves.
const NOW = new Date('2026-07-15T12:00:00.000Z');

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetDb();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function periodsFor(employeeId: number): Promise<string[]> {
  const rows = await prisma.leaveAccrual.findMany({
    where: { employeeId },
    orderBy: { period: 'asc' },
    select: { period: true },
  });
  return rows.map((row) => row.period.toISOString().slice(0, 10));
}

describe('ensureAccrualsUpToDate', () => {
  it('accrues from the join month when the employee has always been full-time', async () => {
    const employee = await createEmployee({ joinDate: utc('2026-05-10') });

    await ensureAccrualsUpToDate(employee.id);

    expect(await periodsFor(employee.id)).toEqual(['2026-05-01', '2026-06-01', '2026-07-01']);
  });

  // The bug this anchor exists to fix: a part-timer promoted to full-time used to be granted
  // a retroactive paid day for every month they were part-time, because the catch-up ran from
  // joinDate.
  it('accrues from fullTimeSince, not joinDate, for someone promoted from part-time', async () => {
    const employee = await createEmployee({
      joinDate: utc('2025-01-06'),
      fullTimeSince: utc('2026-06-20'),
    });

    await ensureAccrualsUpToDate(employee.id);

    expect(await periodsFor(employee.id)).toEqual(['2026-06-01', '2026-07-01']);
  });

  it('grants the conversion month itself, matching the rule for a late-month hire', async () => {
    const employee = await createEmployee({
      joinDate: utc('2024-03-01'),
      fullTimeSince: utc('2026-07-30'),
    });

    await ensureAccrualsUpToDate(employee.id);

    expect(await periodsFor(employee.id)).toEqual(['2026-07-01']);
  });

  it('accrues nothing for a part-time employee', async () => {
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      employmentType: 'PART_TIME',
    });

    await ensureAccrualsUpToDate(employee.id);

    expect(await periodsFor(employee.id)).toEqual([]);
  });

  // Converting out of full-time nulls the anchor. The employment type alone already stops
  // accrual, but the anchor guard is what keeps a half-converted row from generating.
  it('accrues nothing for a full-timer with no anchor', async () => {
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      fullTimeSince: null,
    });

    await ensureAccrualsUpToDate(employee.id);

    expect(await periodsFor(employee.id)).toEqual([]);
  });

  it('accrues nothing for an inactive employee', async () => {
    const employee = await createEmployee({ joinDate: utc('2026-05-10'), terminated: true });

    await ensureAccrualsUpToDate(employee.id);

    expect(await periodsFor(employee.id)).toEqual([]);
  });

  it('is idempotent — a second run creates no duplicates', async () => {
    const employee = await createEmployee({ joinDate: utc('2026-05-10') });

    const first = await ensureAccrualsUpToDate(employee.id);
    const second = await ensureAccrualsUpToDate(employee.id);

    expect(first).toBe(3);
    expect(second).toBe(0);
    expect(await periodsFor(employee.id)).toHaveLength(3);
  });

  it('preserves rows earned in an earlier full-time stint when the anchor moved forward', async () => {
    // Converted out and back: the anchor now points at the second stint, but days already
    // earned in the first are the employee's and must survive.
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      fullTimeSince: utc('2026-07-01'),
    });
    await prisma.leaveAccrual.create({
      data: {
        employeeId: employee.id,
        employmentId: (await currentEmployment(employee.id)).id,
        period: utc('2026-01-01'),
        days: 1,
        daysConsumed: 0,
        expiresAt: utc('2027-07-01'),
      },
    });

    await ensureAccrualsUpToDate(employee.id);

    // January survives; the part-time gap months February–June are never generated.
    expect(await periodsFor(employee.id)).toEqual(['2026-01-01', '2026-07-01']);
  });

  it('sets an 18-month expiry on each generated row', async () => {
    const employee = await createEmployee({ joinDate: utc('2026-07-01') });

    await ensureAccrualsUpToDate(employee.id);

    const row = await prisma.leaveAccrual.findFirstOrThrow({ where: { employeeId: employee.id } });
    expect(row.expiresAt.toISOString().slice(0, 10)).toBe('2028-01-01');
  });
});
