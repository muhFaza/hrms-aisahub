import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/prisma';
import {
  createEmployee,
  createHoliday,
  createLeaveRequest,
  resetDb,
  utc,
} from '../../../__tests__/helpers/factories';
import * as payrollService from '../service';

// Leave rows carry no status: the gather query must pick a sick record up on its dates
// alone, or a deduction people are paid on would silently vanish.
beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('payroll preview — sick leave', () => {
  it('deducts the in-period working days of a sick leave record', async () => {
    const employee = await createEmployee({ monthlySalary: 10_500_000 });
    await createHoliday('2026-07-08', 'Mid-week holiday');
    // Mon 6th - Fri 10th, minus the Wed 8th holiday => 4 deductible days.
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-10',
      totalDays: 4,
      type: 'SICK',
    });
    const period = await prisma.payrollPeriod.create({
      data: { year: 2026, month: 7, exchangeRate: 16_000, rateSource: 'FALLBACK', status: 'DRAFT' },
    });

    const preview = await payrollService.getPeriodPreview(period.id);
    const row = preview.rows.find((r) => r.employeeId === employee.id);

    expect(row?.detail.sickDays).toBe(4);
    // dailyRate = 10,500,000 / 21 = 500,000; x4 = 2,000,000.
    expect(row?.leaveDeduction).toBe(2_000_000);
    expect(row?.totalIdr).toBe(10_500_000 - 2_000_000);
  });
});

// Proration is the whole reason termination has an effective date. August 2026 has 21
// working days (the 1st is a Saturday), so the arithmetic below is checkable by hand.
describe('payroll preview — prorated final month', () => {
  async function augustPeriod() {
    return prisma.payrollPeriod.create({
      data: { year: 2026, month: 8, exchangeRate: 16_000, rateSource: 'FALLBACK', status: 'DRAFT' },
    });
  }

  it('pays a full month to somebody employed throughout', async () => {
    const employee = await createEmployee({ monthlySalary: 21_000_000, joinDate: utc('2025-01-01') });
    const period = await augustPeriod();

    const row = (await payrollService.getPeriodPreview(period.id)).rows.find(
      (r) => r.employeeId === employee.id,
    );

    expect(row?.basicSalary).toBe(21_000_000);
    // No proration block at all on a full month — that absence is what the payslip PDF
    // keys off to decide whether to print a proration line.
    expect(row?.detail.proration).toBeUndefined();
  });

  it('prorates the month someone is terminated part-way through', async () => {
    // Terminated on Fri 14 Aug: 10 of the month's 21 working days.
    const employee = await createEmployee({
      monthlySalary: 21_000_000,
      joinDate: utc('2025-01-01'),
      terminated: utc('2026-08-14'),
    });
    const period = await augustPeriod();

    const row = (await payrollService.getPeriodPreview(period.id)).rows.find(
      (r) => r.employeeId === employee.id,
    );

    expect(row?.detail.proration?.workedWorkingDays).toBe(10);
    expect(row?.detail.proration?.monthWorkingDays).toBe(21);
    expect(row?.detail.proration?.fullMonthSalary).toBe(21_000_000);
    expect(row?.basicSalary).toBe(10_000_000); // 21,000,000 x 10/21
    expect(row?.totalIdr).toBe(10_000_000);
  });

  it('still pays a full month when the last day is the final working day', async () => {
    const employee = await createEmployee({
      monthlySalary: 21_000_000,
      joinDate: utc('2025-01-01'),
      terminated: utc('2026-08-31'),
    });
    const period = await augustPeriod();

    const row = (await payrollService.getPeriodPreview(period.id)).rows.find(
      (r) => r.employeeId === employee.id,
    );

    expect(row?.basicSalary).toBe(21_000_000);
  });

  it('keeps a terminated employee on the month they worked, rather than erasing them', async () => {
    // The old isActive filter dropped them from the month entirely, so their final partial
    // month paid nothing at all.
    const employee = await createEmployee({
      monthlySalary: 21_000_000,
      joinDate: utc('2025-01-01'),
      terminated: utc('2026-08-14'),
    });
    const period = await augustPeriod();

    const rows = (await payrollService.getPeriodPreview(period.id)).rows;
    expect(rows.some((r) => r.employeeId === employee.id)).toBe(true);
  });

  it('drops somebody whose employment ended before the month began', async () => {
    const employee = await createEmployee({
      monthlySalary: 21_000_000,
      joinDate: utc('2025-01-01'),
      terminated: utc('2026-06-30'),
    });
    const period = await augustPeriod();

    const rows = (await payrollService.getPeriodPreview(period.id)).rows;
    expect(rows.some((r) => r.employeeId === employee.id)).toBe(false);
  });
});

// Regressions from review. September 2026 has 22 working days and no seeded holidays, so
// every figure below is checkable by hand.
describe('payroll preview — proration interacting with leave', () => {
  async function septemberPeriod() {
    return prisma.payrollPeriod.create({
      data: { year: 2026, month: 9, exchangeRate: 16_000, rateSource: 'FALLBACK', status: 'DRAFT' },
    });
  }

  it('never produces a negative payslip when a prorated month is entirely sick leave', async () => {
    // basic = 22,000,000 x 11/22 = 11,000,000, but 11 sick days at the /21 daily rate is
    // 11,523,810. Before the floor this paid MINUS 523,810.
    const employee = await createEmployee({
      monthlySalary: 22_000_000,
      joinDate: utc('2025-01-01'),
      terminated: utc('2026-09-15'),
    });
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-09-01',
      endDate: '2026-09-15',
      totalDays: 11,
      type: 'SICK',
    });
    const period = await septemberPeriod();

    const row = (await payrollService.getPeriodPreview(period.id)).rows.find(
      (r) => r.employeeId === employee.id,
    );

    expect(row?.basicSalary).toBe(11_000_000);
    expect(row?.leaveDeduction).toBe(11_000_000); // capped at what it is deducted from
    expect(row?.totalIdr).toBe(0);
    expect(row!.totalIdr).toBeGreaterThanOrEqual(0);
  });

  it('deducts only the leave days that fall inside the employment', async () => {
    // Sick 10-24 Sep is 11 working days, but employment ends on the 15th, so only 4 of them
    // (10, 11, 14, 15) were days the employee was being paid for.
    const employee = await createEmployee({
      monthlySalary: 22_000_000,
      joinDate: utc('2025-01-01'),
      terminated: utc('2026-09-15'),
    });
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-09-10',
      endDate: '2026-09-24',
      totalDays: 11,
      type: 'SICK',
    });
    const period = await septemberPeriod();

    const row = (await payrollService.getPeriodPreview(period.id)).rows.find(
      (r) => r.employeeId === employee.id,
    );

    expect(row?.detail.sickDays).toBe(4);
    // 4 x (22,000,000 / 21) = 4,190,476
    expect(row?.leaveDeduction).toBe(4_190_476);
    expect(row?.totalIdr).toBe(11_000_000 - 4_190_476);
  });

  it('does not pay overtime dated after the employment ended', async () => {
    const employee = await createEmployee({
      monthlySalary: 22_000_000,
      joinDate: utc('2025-01-01'),
      terminated: utc('2026-09-15'),
    });
    // Approved, inside the payroll month, but after the last day of employment. Reachable
    // whenever a termination is recorded late.
    await prisma.overtime.create({
      data: {
        employeeId: employee.id,
        date: utc('2026-09-22'),
        hours: 4,
        status: 'APPROVED',
        description: 'late entry',
      },
    });
    const period = await septemberPeriod();

    const row = (await payrollService.getPeriodPreview(period.id)).rows.find(
      (r) => r.employeeId === employee.id,
    );

    expect(row?.detail.overtimeHours).toBe(0);
    expect(row?.overtimePay).toBe(0);
  });

  it('scopes the attendance block to the employment so it agrees with the proration line', async () => {
    const employee = await createEmployee({
      monthlySalary: 22_000_000,
      joinDate: utc('2025-01-01'),
      terminated: utc('2026-09-15'),
    });
    const period = await septemberPeriod();

    const row = (await payrollService.getPeriodPreview(period.id)).rows.find(
      (r) => r.employeeId === employee.id,
    );

    // "scheduled 22 / actual 22" beside "worked 11 of 22" is what an employee brings to HR.
    expect(row?.detail.attendance?.scheduledWorkingDays).toBe(11);
    expect(row?.detail.proration?.workedWorkingDays).toBe(11);
  });
});
