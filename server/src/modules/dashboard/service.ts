import { prisma } from '../../config/prisma';
import type { AuthUser } from '../../middleware/auth';
import { countWorkingDays } from '../../lib/workingDays';
import { getBalanceBreakdown } from '../../lib/accrual';

// Role-scoped dashboard aggregates (design §6). Read-only: gathers counts and short
// lists per role. "Today"/"this month" are UTC-based so they line up with @db.Date rows.

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

interface OnLeaveTodayEntry {
  employeeName: string;
  type: string;
  until: Date;
}

interface UpcomingHoliday {
  name: string;
  date: Date;
  type: string;
}

// Who is off today — public within the company, so both roles get the same list.
async function getOnLeaveToday(today: Date): Promise<OnLeaveTodayEntry[]> {
  const leaves = await prisma.leaveRequest.findMany({
    where: { startDate: { lte: today }, endDate: { gte: today } },
    include: { employee: { select: { fullName: true } } },
    orderBy: { endDate: 'asc' },
  });
  return leaves.map((leave) => ({
    employeeName: leave.employee.fullName,
    type: leave.type,
    until: leave.endDate,
  }));
}

// Holidays within the next 30 days (inclusive of today).
async function getUpcomingHolidays(today: Date): Promise<UpcomingHoliday[]> {
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + 30);
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: today, lte: horizon } },
    orderBy: { date: 'asc' },
  });
  return holidays.map((holiday) => ({ name: holiday.name, date: holiday.date, type: holiday.type }));
}

export async function getHrDashboard() {
  const today = startOfUtcDay(new Date());
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const [
    total,
    active,
    fullTime,
    partTime,
    pendingOvertime,
    pendingReimbursements,
    onLeaveToday,
    upcomingHolidays,
    latestPeriod,
    monthLeaves,
    monthHolidays,
  ] = await Promise.all([
    prisma.employee.count(),
    prisma.employee.count({ where: { isActive: true } }),
    prisma.employee.count({ where: { employmentType: 'FULL_TIME' } }),
    prisma.employee.count({ where: { employmentType: 'PART_TIME' } }),
    prisma.overtime.count({ where: { status: 'PENDING' } }),
    prisma.reimbursement.count({ where: { status: 'PENDING' } }),
    getOnLeaveToday(today),
    getUpcomingHolidays(today),
    prisma.payrollPeriod.findFirst({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { _count: { select: { payslips: true } } },
    }),
    prisma.leaveRequest.findMany({
      where: { startDate: { lte: monthEnd }, endDate: { gte: monthStart } },
      select: { startDate: true, endDate: true },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
      select: { date: true },
    }),
  ]);

  // Leave days that actually fall within the current month (clip cross-month records,
  // exclude weekends/holidays — same rule as the working-day counter).
  const holidayKeys = monthHolidays.map((holiday) => holiday.date.toISOString().slice(0, 10));
  let leaveThisMonth = 0;
  for (const leave of monthLeaves) {
    const start = leave.startDate > monthStart ? leave.startDate : monthStart;
    const end = leave.endDate < monthEnd ? leave.endDate : monthEnd;
    if (start > end) continue;
    leaveThisMonth += countWorkingDays(start, end, holidayKeys);
  }

  return {
    headcount: { total, fullTime, partTime, active },
    // Leave has no approval queue; only overtime and reimbursements are reviewed.
    pendingApprovals: {
      overtime: pendingOvertime,
      reimbursements: pendingReimbursements,
    },
    onLeaveToday,
    upcomingHolidays,
    payroll: {
      latestPeriod: latestPeriod
        ? {
            year: latestPeriod.year,
            month: latestPeriod.month,
            status: latestPeriod.status,
            payslipCount: latestPeriod._count.payslips,
          }
        : null,
    },
    leaveThisMonth,
  };
}

export async function getEmployeeDashboard(actor: AuthUser) {
  const today = startOfUtcDay(new Date());
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const [onLeaveToday, upcomingHolidays] = await Promise.all([
    getOnLeaveToday(today),
    getUpcomingHolidays(today),
  ]);

  const employeeId = actor.employeeId;
  if (!employeeId) {
    return {
      leaveBalance: null,
      pending: { overtime: 0, reimbursements: 0 },
      onLeaveToday,
      upcomingHolidays,
      thisMonth: {},
      latestPayslip: null,
    };
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { employmentType: true },
  });
  const isFullTime = employee?.employmentType === 'FULL_TIME';

  const [pendingOvertime, pendingReimbursements, latestPayslip, monthHours] =
    await Promise.all([
      prisma.overtime.count({ where: { employeeId, status: 'PENDING' } }),
      prisma.reimbursement.count({ where: { employeeId, status: 'PENDING' } }),
      prisma.payslip.findFirst({
        where: { employeeId, payrollPeriod: { status: 'FINALIZED' } },
        include: { payrollPeriod: { select: { year: true, month: true } } },
        orderBy: [{ payrollPeriod: { year: 'desc' } }, { payrollPeriod: { month: 'desc' } }],
      }),
      isFullTime
        ? prisma.overtime.aggregate({
            where: { employeeId, status: 'APPROVED', date: { gte: monthStart, lte: monthEnd } },
            _sum: { hours: true },
          })
        : prisma.dailyLog.aggregate({
            where: { employeeId, date: { gte: monthStart, lte: monthEnd } },
            _sum: { hours: true },
          }),
    ]);

  const leaveBalance = isFullTime ? await getBalanceBreakdown(employeeId) : null;
  const hours = Number(monthHours._sum.hours ?? 0);
  const thisMonth = isFullTime ? { approvedOvertimeHours: hours } : { dailyLogHours: hours };

  return {
    leaveBalance,
    pending: {
      overtime: pendingOvertime,
      reimbursements: pendingReimbursements,
    },
    onLeaveToday,
    upcomingHolidays,
    thisMonth,
    latestPayslip: latestPayslip
      ? {
          period: { year: latestPayslip.payrollPeriod.year, month: latestPayslip.payrollPeriod.month },
          totalIdr: Number(latestPayslip.totalIdr),
        }
      : null,
  };
}
