import {
  countHolidaysOnWeekdays,
  countWeekdays,
  countWeekendDays,
  countWorkingDays,
  offDayHolidayKeys,
  toDateKey,
  type HolidayLike,
} from './workingDays';
import {
  employmentSegments,
  isFullMonth,
  prorateMonth,
  type DateRange,
  type EmploymentLike,
} from './employment';

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

// SICK and UNPAID leave both deduct salary; PAID never does. The caller passes every type in
// one list: each deducting type is counted separately for the payslip breakdown, and all three
// together make up the days absent in the attendance summary.
export interface LeaveRecord {
  id: number;
  type: string;
  startDate: Date;
  endDate: Date;
}

export interface ComputeContext {
  overtimes: OvertimeRecord[];
  dailyLogs: DailyLogRecord[];
  reimbursements: ReimbursementRecord[];
  leaves: LeaveRecord[];
  holidays: HolidayLike[];
  // The employee's employments overlapping this period — normally one, two if they were
  // terminated and rehired within it. Optional, and an empty or absent list means "do not
  // prorate" rather than "pay nothing" — see prorateMonth for why that direction.
  employments?: EmploymentLike[];
  exchangeRate: number;
  periodStart: Date;
  periodEnd: Date;
}

// Attendance for the pay period, frozen alongside the money at finalize time. Holidays are not
// period-locked, so recomputing this at export time would let a payslip change after it was
// issued — it is snapshotted for the same reason every other figure here is.
export interface PayslipAttendance {
  periodStart: string; // 'YYYY-MM-DD'
  periodEnd: string;
  // Weekdays in the period, before holidays or leave are taken off. Joint leave is worked, so
  // it is not deducted here or anywhere below.
  scheduledWorkingDays: number;
  actualWorkingDays: number;
  dayOffDays: number; // weekend days
  nationalHolidayDays: number;
  companyHolidayDays: number; // COMPANY and SPECIAL
  leaveDays: number; // paid + sick + unpaid working days falling in the period
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
  // Present only when the employee was not employed for the whole month — a joiner, or
  // somebody terminated part-way through. Absent on a full month, which is what the payslip
  // PDF keys off to decide whether to show a proration line at all.
  proration?: {
    workedWorkingDays: number;
    monthWorkingDays: number;
    fullMonthSalary: number; // what basicSalary would have been without proration
  };
  exchangeRate: number;
  // Optional: payslips finalized before the attendance summary existed have no such block, and
  // their PDFs omit the section rather than invent numbers.
  attendance?: PayslipAttendance;
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

// Splits a stored leaveDeduction back into its sick and unpaid halves for display.
//
// Per-type money is never stored: leaveDeduction is rounded once over the combined days so the
// two breakdown lines cannot disagree with the total they sum to. Deriving sick from dailyRate
// and handing unpaid the remainder keeps them summing to the stored total exactly, whatever
// the rounding did.
//
// Payslips finalized before unpaid leave existed have neither field in their stored detail,
// hence the `?? 0` reads. client/src/pages/payroll/PayslipBreakdown.tsx mirrors this; the
// wire boundary rules out sharing the code, so this copy is the tested definition.
export function splitLeaveDeduction(
  detail: Pick<PayslipDetail, 'sickDays' | 'unpaidDays' | 'dailyRate'>,
  leaveDeduction: number,
): { sickDays: number; unpaidDays: number; sickDeduction: number; unpaidDeduction: number } {
  const sickDays = detail.sickDays ?? 0;
  const unpaidDays = detail.unpaidDays ?? 0;
  const sickDeduction =
    unpaidDays === 0 ? leaveDeduction : Math.round(sickDays * (detail.dailyRate ?? 0));
  return {
    sickDays,
    unpaidDays,
    sickDeduction,
    unpaidDeduction: leaveDeduction - sickDeduction,
  };
}

// @db.Date values arrive as UTC midnight; both boundaries are inclusive.
function inPeriod(date: Date, start: Date, end: Date): boolean {
  return date >= start && date <= end;
}

function roundIdr(value: number): number {
  return Math.round(value);
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

// Working days of the given leave types, clipped to the pay period (a request can span
// boundaries — only the in-period days count). Weekends and off-day holidays are excluded; joint
// leave is a working day and so does count against leave taken across it.
function daysInPeriodByType(
  leaves: LeaveRecord[],
  types: readonly string[],
  holidays: Set<string>,
  periodStart: Date,
  periodEnd: Date,
): { days: number; ids: number[] } {
  let days = 0;
  const ids: number[] = [];
  for (const leave of leaves) {
    if (!types.includes(leave.type)) continue;
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

// PAID deducts nothing but is still a day the employee was absent, so the attendance summary
// counts all three types where the deduction counts only two.
const ALL_LEAVE = ['PAID', 'SICK', 'UNPAID'] as const;

/**
 * Attendance for one employee over the pay period.
 *
 * The full-time figures reconcile exactly:
 *
 *     scheduled = actual + national + company + leave
 *     calendar  = scheduled + dayOff
 *
 * Scheduled counts every weekday, holidays included, and the holiday lines then take days back
 * off it — so the block reads as an explanation of where a month's weekdays went. Joint leave
 * appears nowhere: those days are worked, so they stay inside `actual`.
 *
 * A part-timer has no fixed schedule, so `actualWorkingDays` is the number of distinct dates
 * they logged and `scheduledWorkingDays` is left at the calendar weekday count for context.
 */
function computeAttendance(
  employee: PayrollEmployee,
  ctx: ComputeContext,
  offDayKeys: Set<string>,
): PayslipAttendance {
  const { periodStart, periodEnd } = ctx;

  // Counted over the parts of the month the employee was actually employed, not the whole
  // month. For anyone employed throughout — almost everybody — the segments are the whole
  // month and nothing changes. For a joiner or a leaver it stops the block contradicting the
  // proration line beside it: "scheduled 22 / actual 22" next to "worked 11 of 22" is exactly
  // the sort of disagreement an employee brings to HR to dispute their pay.
  const segments = employmentSegments(ctx.employments ?? [], periodStart, periodEnd);
  const covered: DateRange[] =
    segments.length > 0 ? segments : [{ start: periodStart, end: periodEnd }];
  const sumOver = (fn: (start: Date, end: Date) => number): number =>
    covered.reduce((total, segment) => total + fn(segment.start, segment.end), 0);

  const scheduledWorkingDays = sumOver(countWeekdays);
  const dayOffDays = sumOver(countWeekendDays);
  const nationalHolidayDays = sumOver((start, end) =>
    countHolidaysOnWeekdays(ctx.holidays, ['NATIONAL'], start, end),
  );
  // SPECIAL is folded in with COMPANY: both are employer-declared days off, and splitting them
  // out would add a line that is almost always zero.
  const companyHolidayDays = sumOver((start, end) =>
    countHolidaysOnWeekdays(ctx.holidays, ['COMPANY', 'SPECIAL'], start, end),
  );

  if (employee.employmentType === 'PART_TIME') {
    const loggedDates = new Set(
      ctx.dailyLogs
        .filter((log) => inPeriod(log.date, periodStart, periodEnd))
        .map((log) => toDateKey(log.date)),
    );
    return {
      periodStart: toDateKey(periodStart),
      periodEnd: toDateKey(periodEnd),
      scheduledWorkingDays,
      actualWorkingDays: loggedDates.size,
      dayOffDays,
      nationalHolidayDays,
      companyHolidayDays,
      leaveDays: 0, // part-timers cannot record leave
    };
  }

  const leaveDays = daysInPeriodByType(
    ctx.leaves,
    ALL_LEAVE,
    offDayKeys,
    periodStart,
    periodEnd,
  ).days;

  return {
    periodStart: toDateKey(periodStart),
    periodEnd: toDateKey(periodEnd),
    scheduledWorkingDays,
    actualWorkingDays:
      scheduledWorkingDays - nationalHolidayDays - companyHolidayDays - leaveDays,
    dayOffDays,
    nationalHolidayDays,
    companyHolidayDays,
    leaveDays,
  };
}

// Computes one payslip row for an employee against the period's gathered source data.
export function computePayslipRow(employee: PayrollEmployee, ctx: ComputeContext): PayslipRow {
  const { exchangeRate, periodStart, periodEnd } = ctx;
  const offDayKeys = offDayHolidayKeys(ctx.holidays);
  const attendance = computeAttendance(employee, ctx, offDayKeys);

  const reimbursementsInPeriod = ctx.reimbursements.filter(
    (r) => r.status === 'APPROVED' && inPeriod(r.date, periodStart, periodEnd),
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
      (o) => o.status === 'APPROVED' && inPeriod(o.date, periodStart, periodEnd),
    );
    const overtimeHours = overtimesInPeriod.reduce((sum, o) => sum + o.hours, 0);
    const overtimeIds = overtimesInPeriod.map((o) => o.id);

    const sick = daysInPeriodByType(
      ctx.leaves,
      ['SICK'],
      offDayKeys,
      periodStart,
      periodEnd,
    );
    const unpaid = daysInPeriodByType(
      ctx.leaves,
      ['UNPAID'],
      offDayKeys,
      periodStart,
      periodEnd,
    );

    // Proration for a partial month — someone who joined or was terminated part-way through.
    // Dividing by the month's real working-day count can never pay more than a full month or
    // less than zero, so no cap or floor is needed. See lib/employment.ts for why this
    // divisor differs from the 21 used for dailyRate just above.
    const proration = prorateMonth({
      employments: ctx.employments ?? [],
      monthStart: periodStart,
      monthEnd: periodEnd,
      holidayKeys: offDayKeys,
    });
    const partialMonth = !isFullMonth(proration);

    basicSalary = roundIdr(monthlySalary * proration.factor);

    // The deduction can never exceed the salary it is deducted from.
    //
    // This became reachable when proration landed: basicSalary now shrinks with the days
    // worked while the leave deduction keeps the full-month `salary / 21` rate, so the two
    // can cross. Somebody employed 1-15 September (11 working days of 22) and sick for all of
    // them computed 11,000,000 basic against an 11,523,810 deduction — a payslip of
    // MINUS 523,810. Zero is the answer: they were employed and absent, so they earn nothing,
    // but a payroll system must never hand somebody a negative net.
    //
    // The cap is applied after the leave days themselves have been clipped to the employment
    // (see computeRows), so it only ever absorbs the residue of the two divisors disagreeing.
    overtimePay = roundIdr(overtimeHours * derivedHourly);
    // Rounded once over the combined days, not per type: rounding each separately would let
    // the two payslip breakdown lines disagree with the total they sum to.
    leaveDeduction = Math.min(roundIdr((sick.days + unpaid.days) * dailyRate), basicSalary);

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
      ...(partialMonth
        ? {
            proration: {
              workedWorkingDays: proration.workedWorkingDays,
              monthWorkingDays: proration.monthWorkingDays,
              fullMonthSalary: roundIdr(monthlySalary),
            },
          }
        : {}),
      exchangeRate,
      attendance,
    };
  } else {
    const hourlyRate = Number(employee.hourlyRate ?? 0);
    const logsInPeriod = ctx.dailyLogs.filter((l) => inPeriod(l.date, periodStart, periodEnd));
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
      attendance,
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
