import { describe, expect, it } from 'vitest';
import {
  computePayslipRow,
  splitLeaveDeduction,
  type ComputeContext,
  type PayrollEmployee,
} from '../payroll';

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const RATE = 16_000;

function baseContext(overrides: Partial<ComputeContext> = {}): ComputeContext {
  return {
    overtimes: [],
    dailyLogs: [],
    reimbursements: [],
    deductibleLeaves: [],
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
        deductibleLeaves: [
          {
            id: 7,
            type: 'SICK',
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

  it('deducts unpaid leave on the same mechanics as sick leave', () => {
    const row = computePayslipRow(
      fullTime,
      baseContext({
        // Jul 6 (Mon) – Jul 8 (Wed) → 3 working days.
        deductibleLeaves: [
          { id: 9, type: 'UNPAID', startDate: d('2026-07-06'), endDate: d('2026-07-08') },
        ],
      }),
    );
    expect(row.detail.unpaidDays).toBe(3);
    expect(row.detail.unpaidLeaveIds).toEqual([9]);
    expect(row.detail.sickDays).toBe(0);
    // 476,190.476… × 3 = 1,428,571.43 → 1,428,571.
    expect(row.leaveDeduction).toBe(1_428_571);
    expect(row.totalIdr).toBe(10_000_000 - 1_428_571);
  });

  it('excludes weekends and holidays from unpaid leave', () => {
    const row = computePayslipRow(
      fullTime,
      baseContext({
        // Jul 3 (Fri) – Jul 8 (Wed): Sat 4 and Sun 5 drop out, Jul 6 is a holiday →
        // Jul 3, 7, 8 remain = 3 days.
        deductibleLeaves: [
          { id: 1, type: 'UNPAID', startDate: d('2026-07-03'), endDate: d('2026-07-08') },
        ],
        holidays: [d('2026-07-06')],
      }),
    );
    expect(row.detail.unpaidDays).toBe(3);
  });

  it('clips unpaid leave to the period for a cross-month request', () => {
    const row = computePayslipRow(
      fullTime,
      baseContext({
        // Jun 29 – Jul 2; only Jul 1 (Wed) and Jul 2 (Thu) fall in the period.
        deductibleLeaves: [
          { id: 4, type: 'UNPAID', startDate: d('2026-06-29'), endDate: d('2026-07-02') },
        ],
      }),
    );
    expect(row.detail.unpaidDays).toBe(2);
    expect(row.leaveDeduction).toBe(952_381);
  });

  it('sums sick and unpaid into one deduction that the two lines reconcile to', () => {
    const row = computePayslipRow(
      fullTime,
      baseContext({
        deductibleLeaves: [
          // Jul 6 (Mon) – Jul 7 (Tue) → 2 sick days.
          { id: 1, type: 'SICK', startDate: d('2026-07-06'), endDate: d('2026-07-07') },
          // Jul 13 (Mon) – Jul 15 (Wed) → 3 unpaid days.
          { id: 2, type: 'UNPAID', startDate: d('2026-07-13'), endDate: d('2026-07-15') },
        ],
      }),
    );
    expect(row.detail.sickDays).toBe(2);
    expect(row.detail.unpaidDays).toBe(3);
    expect(row.detail.sickLeaveIds).toEqual([1]);
    expect(row.detail.unpaidLeaveIds).toEqual([2]);
    // Rounded once over 5 combined days: 476,190.476… × 5 = 2,380,952.38 → 2,380,952.
    // Rounding each type separately would give 952,381 + 1,428,571 = 2,380,952 here, but the
    // combined round is what the payslip breakdown reconciles against.
    expect(row.leaveDeduction).toBe(2_380_952);
    expect(row.totalIdr).toBe(10_000_000 - 2_380_952);
  });

  it('ignores PAID leave entirely when computing the deduction', () => {
    const row = computePayslipRow(
      fullTime,
      baseContext({
        deductibleLeaves: [
          { id: 3, type: 'PAID', startDate: d('2026-07-06'), endDate: d('2026-07-08') },
        ],
      }),
    );
    expect(row.detail.sickDays).toBe(0);
    expect(row.detail.unpaidDays).toBe(0);
    expect(row.leaveDeduction).toBe(0);
    expect(row.totalIdr).toBe(10_000_000);
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

  // Part-timers can no longer record leave at all, but historical records survive for HR to
  // audit. They must never produce a deduction: an hourly employee is already unpaid for a
  // day they did not log.
  it('never deducts for a part-timer, even with historical leave records', () => {
    const row = computePayslipRow(
      partTime,
      baseContext({
        dailyLogs: [{ id: 1, date: d('2026-07-01'), hours: 8 }],
        deductibleLeaves: [
          { id: 1, type: 'SICK', startDate: d('2026-07-06'), endDate: d('2026-07-07') },
          { id: 2, type: 'UNPAID', startDate: d('2026-07-13'), endDate: d('2026-07-15') },
        ],
      }),
    );
    expect(row.detail.sickDays).toBe(0);
    expect(row.detail.unpaidDays).toBe(0);
    expect(row.detail.unpaidLeaveIds).toEqual([]);
    expect(row.leaveDeduction).toBe(0);
    expect(row.totalIdr).toBe(400_000);
  });
});

// The payslip PDF and the client breakdown both split a stored leaveDeduction back into its
// two lines. The invariant is that they sum to the stored total exactly, whatever rounding did
// when the payslip was frozen.
describe('splitLeaveDeduction', () => {
  it('gives the whole deduction to sick when there is no unpaid leave', () => {
    const split = splitLeaveDeduction({ sickDays: 2, unpaidDays: 0, dailyRate: 476_190 }, 952_381);
    expect(split.sickDeduction).toBe(952_381);
    expect(split.unpaidDeduction).toBe(0);
  });

  it('gives the whole deduction to unpaid when there is no sick leave', () => {
    const split = splitLeaveDeduction({ sickDays: 0, unpaidDays: 2, dailyRate: 476_190 }, 952_381);
    expect(split.sickDeduction).toBe(0);
    expect(split.unpaidDeduction).toBe(952_381);
  });

  it('sums to the stored total when both types are present and rounding disagrees', () => {
    const split = splitLeaveDeduction({ sickDays: 1, unpaidDays: 1, dailyRate: 476_190 }, 952_381);
    expect(split.sickDeduction).toBe(476_190);
    expect(split.unpaidDeduction).toBe(476_191); // absorbs the rounding remainder
    expect(split.sickDeduction + split.unpaidDeduction).toBe(952_381);
  });

  it('sums to the stored total for a fractional day split', () => {
    const split = splitLeaveDeduction({ sickDays: 0.5, unpaidDays: 1.5, dailyRate: 333_333 }, 666_666);
    expect(split.sickDeduction + split.unpaidDeduction).toBe(666_666);
  });

  // A payslip finalized before unpaid leave existed has neither field in its stored JSON.
  it('treats a legacy snapshot as sick-only rather than yielding NaN', () => {
    const split = splitLeaveDeduction({ sickDays: 1, dailyRate: 476_190 } as never, 476_190);
    expect(split.unpaidDays).toBe(0);
    expect(split.sickDeduction).toBe(476_190);
    expect(split.unpaidDeduction).toBe(0);
  });

  it('is zero across the board when nothing was deducted', () => {
    const split = splitLeaveDeduction({ sickDays: 0, unpaidDays: 0, dailyRate: 476_190 }, 0);
    expect(split).toEqual({ sickDays: 0, unpaidDays: 0, sickDeduction: 0, unpaidDeduction: 0 });
  });

  // Part-timers have no dailyRate in their detail at all.
  it('does not produce NaN when dailyRate is absent', () => {
    const split = splitLeaveDeduction({ sickDays: 0, unpaidDays: 0 }, 0);
    expect(Number.isNaN(split.sickDeduction)).toBe(false);
    expect(Number.isNaN(split.unpaidDeduction)).toBe(false);
  });
});
