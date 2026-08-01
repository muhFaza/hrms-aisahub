import { countWorkingDays } from './workingDays';

// Pure payroll math (design §4). DB access is kept out of here on purpose: the service
// gathers rows and passes plain numbers/Dates so this stays unit-testable (Phase 6).

export type EmploymentType = 'FULL_TIME' | 'PART_TIME';

export interface PayrollEmployee {
  id: number;
  fullName: string;
  nickname?: string | null;
  employmentType: EmploymentType;
  monthlySalary?: number | null;
  hourlyRate?: number | null;
}

export interface OvertimeRecord {
  id: number;
  date: Date;
  hours: number;
  status: string;
}

export interface DailyLogRecord {
  id: number;
  date: Date;
  hours: number;
}

export interface ReimbursementRecord {
  id: number;
  date: Date;
  amount: number;
  status: string;
}

// SICK and UNPAID leave both deduct salary; PAID never does. The caller passes both types
// in one list and each is counted separately for the payslip breakdown.
export interface DeductibleLeaveRecord {
  id: number;
  type: string;
  startDate: Date;
  endDate: Date;
}

export interface ComputeContext {
  overtimes: OvertimeRecord[];
  dailyLogs: DailyLogRecord[];
  reimbursements: ReimbursementRecord[];
  deductibleLeaves: DeductibleLeaveRecord[];
  holidays: Date[];
  exchangeRate: number;
  year: number;
  month: number; // 1-12
}

export interface PayslipDetail {
  employmentType: EmploymentType;
  monthlySalary?: number;
  hourlyRate?: number;
  overtimeHours: number;
  overtimeIds: number[];
  dailyLogHours: number;
  dailyLogIds: number[];
  reimbursementIds: number[];
  sickDays: number;
  sickLeaveIds: number[];
  unpaidDays: number;
  unpaidLeaveIds: number[];
  derivedHourly?: number;
  dailyRate?: number;
  exchangeRate: number;
}

export interface PayslipRow {
  employeeId: number;
  name: string;
  employmentType: EmploymentType;
  basicSalary: number;
  overtimePay: number;
  reimbursementTotal: number;
  leaveDeduction: number;
  totalIdr: number;
  totalUsd: number;
  detail: PayslipDetail;
}

// @db.Date values arrive as UTC midnight; read in UTC so period boundaries are stable.
function inPeriod(date: Date, year: number, month: number): boolean {
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month;
}

function roundIdr(value: number): number {
  return Math.round(value);
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function holidayKeys(holidays: Date[]): Set<string> {
  return new Set(holidays.map((h) => h.toISOString().slice(0, 10)));
}

// Working days of one deducting leave type, clipped to the period month (a request can span
// months — only the in-period days deduct). Weekends and holidays are excluded (design §4).
function daysInPeriodByType(
  leaves: DeductibleLeaveRecord[],
  type: 'SICK' | 'UNPAID',
  holidays: Set<string>,
  year: number,
  month: number,
): { days: number; ids: number[] } {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0)); // last day of month
  let days = 0;
  const ids: number[] = [];
  for (const leave of leaves) {
    if (leave.type !== type) continue;
    const start = leave.startDate > periodStart ? leave.startDate : periodStart;
    const end = leave.endDate < periodEnd ? leave.endDate : periodEnd;
    if (start > end) continue;
    const count = countWorkingDays(start, end, holidays);
    if (count > 0) {
      days += count;
      ids.push(leave.id);
    }
  }
  return { days, ids };
}

// Computes one payslip row for an employee against the period's gathered source data.
export function computePayslipRow(employee: PayrollEmployee, ctx: ComputeContext): PayslipRow {
  const { exchangeRate, year, month } = ctx;

  const reimbursementsInPeriod = ctx.reimbursements.filter(
    (r) => r.status === 'APPROVED' && inPeriod(r.date, year, month),
  );
  const reimbursementTotal = roundIdr(
    reimbursementsInPeriod.reduce((sum, r) => sum + r.amount, 0),
  );
  const reimbursementIds = reimbursementsInPeriod.map((r) => r.id);

  let basicSalary: number;
  let overtimePay = 0;
  let leaveDeduction = 0;
  let detail: PayslipDetail;

  if (employee.employmentType === 'FULL_TIME') {
    const monthlySalary = Number(employee.monthlySalary ?? 0);
    const derivedHourly = monthlySalary / 21 / 8;
    const dailyRate = monthlySalary / 21;

    const overtimesInPeriod = ctx.overtimes.filter(
      (o) => o.status === 'APPROVED' && inPeriod(o.date, year, month),
    );
    const overtimeHours = overtimesInPeriod.reduce((sum, o) => sum + o.hours, 0);
    const overtimeIds = overtimesInPeriod.map((o) => o.id);

    const holidaySet = holidayKeys(ctx.holidays);
    const sick = daysInPeriodByType(ctx.deductibleLeaves, 'SICK', holidaySet, year, month);
    const unpaid = daysInPeriodByType(ctx.deductibleLeaves, 'UNPAID', holidaySet, year, month);

    basicSalary = roundIdr(monthlySalary);
    overtimePay = roundIdr(overtimeHours * derivedHourly);
    // Rounded once over the combined days, not per type: rounding each separately would let
    // the two payslip breakdown lines disagree with the total they sum to.
    leaveDeduction = roundIdr((sick.days + unpaid.days) * dailyRate);

    detail = {
      employmentType: 'FULL_TIME',
      monthlySalary,
      overtimeHours,
      overtimeIds,
      dailyLogHours: 0,
      dailyLogIds: [],
      reimbursementIds,
      sickDays: sick.days,
      sickLeaveIds: sick.ids,
      unpaidDays: unpaid.days,
      unpaidLeaveIds: unpaid.ids,
      derivedHourly: roundUsd(derivedHourly),
      dailyRate: roundIdr(dailyRate),
      exchangeRate,
    };
  } else {
    const hourlyRate = Number(employee.hourlyRate ?? 0);
    const logsInPeriod = ctx.dailyLogs.filter((l) => inPeriod(l.date, year, month));
    const dailyLogHours = logsInPeriod.reduce((sum, l) => sum + l.hours, 0);
    const dailyLogIds = logsInPeriod.map((l) => l.id);

    basicSalary = roundIdr(dailyLogHours * hourlyRate);

    detail = {
      employmentType: 'PART_TIME',
      hourlyRate,
      overtimeHours: 0,
      overtimeIds: [],
      dailyLogHours,
      dailyLogIds,
      reimbursementIds,
      // Part-timers are paid per logged hour, so an unlogged day is already unpaid — there
      // is nothing to deduct. They can no longer record leave at all.
      sickDays: 0,
      sickLeaveIds: [],
      unpaidDays: 0,
      unpaidLeaveIds: [],
      exchangeRate,
    };
  }

  const totalIdr = basicSalary + overtimePay + reimbursementTotal - leaveDeduction;
  const totalUsd = exchangeRate > 0 ? roundUsd(totalIdr / exchangeRate) : 0;

  return {
    employeeId: employee.id,
    name: employee.nickname ?? employee.fullName,
    employmentType: employee.employmentType,
    basicSalary,
    overtimePay,
    reimbursementTotal,
    leaveDeduction,
    totalIdr,
    totalUsd,
    detail,
  };
}
