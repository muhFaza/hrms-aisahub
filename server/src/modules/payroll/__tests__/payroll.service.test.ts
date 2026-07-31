import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../config/prisma';
import {
  createEmployee,
  createHoliday,
  createLeaveRequest,
  resetDb,
} from '../../../__tests__/helpers/factories';
import * as payrollService from '../service';

vi.mock('../../../lib/email', () => ({
  sendPayslipEmail: vi.fn().mockResolvedValue(true),
}));

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
