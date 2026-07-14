import { describe, expect, it } from 'vitest';
import { computePayslipRow, type ComputeContext, type PayrollEmployee } from '../payroll';

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const RATE = 16_000;

function baseContext(overrides: Partial<ComputeContext> = {}): ComputeContext {
  return {
    overtimes: [],
    dailyLogs: [],
    reimbursements: [],
    sickLeaves: [],
    holidays: [],
    exchangeRate: RATE,
    year: 2026,
    month: 7,
    ...overrides,
  };
}

const fullTime: PayrollEmployee = {
  id: 1,
  fullName: 'Budi Santoso',
  nickname: 'Budi',
  employmentType: 'FULL_TIME',
  monthlySalary: 10_000_000,
  hourlyRate: null,
};

const partTime: PayrollEmployee = {
  id: 2,
  fullName: 'Andi Pratama',
  nickname: 'Andi',
  employmentType: 'PART_TIME',
  monthlySalary: null,
  hourlyRate: 50_000,
};

describe('computePayslipRow — full-time', () => {
  it('pays base salary only with no activity', () => {
    const row = computePayslipRow(fullTime, baseContext());
    expect(row.basicSalary).toBe(10_000_000);
    expect(row.overtimePay).toBe(0);
    expect(row.leaveDeduction).toBe(0);
    expect(row.reimbursementTotal).toBe(0);
    expect(row.totalIdr).toBe(10_000_000);
    expect(row.totalUsd).toBe(625); // 10,000,000 / 16,000
  });

  it('adds approved overtime using the ÷21÷8 derived hourly rate', () => {
    const row = computePayslipRow(
      fullTime,
      baseContext({ overtimes: [{ id: 10, date: d('2026-07-10'), hours: 3, status: 'APPROVED' }] }),
    );
    // 10,000,000 / 21 / 8 = 59,523.8095…; ×3 = 178,571.4286 → rounded 178,571.
    expect(row.detail.derivedHourly).toBeCloseTo(59_523.81, 2);
    expect(row.overtimePay).toBe(178_571);
    expect(row.totalIdr).toBe(10_178_571);
    expect(row.totalUsd).toBe(636.16); // 10,178,571 / 16,000 rounded to 2dp
  });

  it('ignores non-approved and out-of-period overtime', () => {
    const row = computePayslipRow(
      fullTime,
      baseContext({
        overtimes: [
          { id: 1, date: d('2026-07-05'), hours: 2, status: 'PENDING' },
          { id: 2, date: d('2026-06-30'), hours: 4, status: 'APPROVED' },
        ],
      }),
    );
    expect(row.overtimePay).toBe(0);
  });

  it('counts only APPROVED reimbursements within the period', () => {
    const row = computePayslipRow(
      fullTime,
      baseContext({
        reimbursements: [
          { id: 1, date: d('2026-07-01'), amount: 200_000, status: 'APPROVED' },
          { id: 2, date: d('2026-07-02'), amount: 500_000, status: 'PENDING' },
          { id: 3, date: d('2026-07-03'), amount: 300_000, status: 'REJECTED' },
          { id: 4, date: d('2026-06-30'), amount: 900_000, status: 'APPROVED' }, // previous month
        ],
      }),
    );
    expect(row.reimbursementTotal).toBe(200_000);
    expect(row.detail.reimbursementIds).toEqual([1]);
  });

  it('deducts sick days clipped to the period for a cross-month request', () => {
    const row = computePayslipRow(
      fullTime,
      baseContext({
        // Jun 29 – Jul 2; only Jul 1 (Wed) and Jul 2 (Thu) fall in the period → 2 days.
        sickLeaves: [
          {
            id: 7,
            type: 'SICK',
            status: 'APPROVED',
            startDate: d('2026-06-29'),
            endDate: d('2026-07-02'),
          },
        ],
      }),
    );
    expect(row.detail.sickDays).toBe(2);
    // dailyRate = 10,000,000 / 21 = 476,190.476…; ×2 = 952,380.95 → 952,381.
    expect(row.leaveDeduction).toBe(952_381);
    expect(row.totalIdr).toBe(10_000_000 - 952_381);
  });
});

describe('computePayslipRow — part-time', () => {
  it('pays logged hours × rate, excluding out-of-period logs', () => {
    const row = computePayslipRow(
      partTime,
      baseContext({
        dailyLogs: [
          { id: 1, date: d('2026-07-01'), hours: 8 },
          { id: 2, date: d('2026-06-30'), hours: 7.5 }, // previous month
          { id: 3, date: d('2026-08-01'), hours: 8 }, // next month
        ],
      }),
    );
    expect(row.detail.dailyLogHours).toBe(8);
    expect(row.basicSalary).toBe(400_000); // 8 × 50,000
    expect(row.totalIdr).toBe(400_000);
    expect(row.totalUsd).toBe(25); // 400,000 / 16,000
  });

  it('is zero for a part-timer with no activity', () => {
    const row = computePayslipRow(partTime, baseContext());
    expect(row.basicSalary).toBe(0);
    expect(row.totalIdr).toBe(0);
    expect(row.totalUsd).toBe(0);
  });
});
