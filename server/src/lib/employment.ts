// Employment-status arithmetic. Pure and UTC-based, like workingDays — the database work
// lives in the services that call this.
//
// THE BOUNDARY RULE, because every function here depends on it and an off-by-one costs
// somebody a day's pay: `endDate` is the LAST DAY OF EMPLOYMENT, inclusive. Terminated
// effective 30 September means 30 September is worked and paid; employment ends at the end
// of that day, so 1 October is the first day the person is no longer employed.

import { countWorkingDays } from './workingDays';

export type EmploymentStatus = 'ACTIVE' | 'TERMINATED';

export interface EmploymentLike {
  startDate: Date;
  endDate: Date | null;
}

// Normalizes to UTC midnight so comparisons are day-granular. A stored date carrying a time
// component would otherwise make "terminated today" true or false depending on the hour.
function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// True when `date` falls inside the employment, both ends inclusive.
export function isEmployedOn(employment: EmploymentLike, date: Date): boolean {
  const day = toUtcDay(date);
  if (day < toUtcDay(employment.startDate)) return false;
  if (employment.endDate === null) return true;
  return day <= toUtcDay(employment.endDate);
}

// Status of the employee's most recent employment as of a date.
//
// A missing employment resolves to TERMINATED, not ACTIVE. Every employee has one after the
// backfill migration, so this only fires on corrupt data — and on a payroll system denying
// access to an unknown state is the safer failure.
export function employmentStatusAsOf(
  employment: EmploymentLike | null | undefined,
  asOf: Date,
): EmploymentStatus {
  if (!employment) return 'TERMINATED';
  if (employment.endDate === null) return 'ACTIVE';
  // Strictly after: on the end date itself the person is still employed.
  return toUtcDay(asOf) > toUtcDay(employment.endDate) ? 'TERMINATED' : 'ACTIVE';
}

export interface ProrationInput {
  // Every employment overlapping the month. Normally one; two when somebody was terminated
  // and rehired within the same month.
  employments: EmploymentLike[];
  monthStart: Date;
  monthEnd: Date;
  // 'YYYY-MM-DD' keys from offDayHolidayKeys — joint leave is a working day.
  holidayKeys: Set<string>;
}

export interface Proration {
  workedWorkingDays: number;
  monthWorkingDays: number;
  // 1 for a full month. Multiply the monthly salary by this.
  factor: number;
}

// Prorates a month by working days actually inside the employment.
//
// Deliberately NOT the /21 divisor used for the daily rate elsewhere in payroll: dividing by
// the month's real working-day count can never pay more than a full month or less than zero,
// so it needs no cap and no floor. The consequence is that a day missed through termination
// and a day missed through sick leave price slightly differently on the same payslip; that is
// recorded as accepted in the design doc and in domain-rules.md.
//
// Overlapping employments would double-count. Nothing in the DATABASE prevents that — the
// partial unique index constrains open employments only, so two CLOSED rows could overlap.
// The guarantee comes from rehireEmployee, which refuses a start date on or before the
// previous end date, inside a transaction holding the employee row lock.
export function prorateMonth(input: ProrationInput): Proration {
  const monthWorkingDays = countWorkingDays(input.monthStart, input.monthEnd, input.holidayKeys);

  // No employment information supplied means "do not prorate", not "pay nothing". The payroll
  // service always passes real rows and only builds a row for someone whose employment
  // overlaps the month, so this is a contract for callers that do not model employment at
  // all. Defaulting the other way would turn a missing join into a zero payslip for an active
  // employee, which is a far worse failure than the full month it used to pay.
  if (input.employments.length === 0) {
    return { workedWorkingDays: monthWorkingDays, monthWorkingDays, factor: 1 };
  }

  let workedWorkingDays = 0;
  for (const employment of input.employments) {
    const from = maxDate(toUtcDay(employment.startDate), toUtcDay(input.monthStart));
    const to =
      employment.endDate === null
        ? toUtcDay(input.monthEnd)
        : minDate(toUtcDay(employment.endDate), toUtcDay(input.monthEnd));
    if (from > to) continue; // employment does not touch this month
    workedWorkingDays += countWorkingDays(from, to, input.holidayKeys);
  }

  // A month with no working days at all (every weekday a public holiday) would divide by
  // zero. Pay the full month rather than nothing: nobody was scheduled to work it.
  const factor = monthWorkingDays === 0 ? 1 : workedWorkingDays / monthWorkingDays;
  return { workedWorkingDays, monthWorkingDays, factor };
}

// True when the employment covers every working day of the month — the common case, and the
// signal that no proration line belongs on the payslip at all.
export function isFullMonth(proration: Proration): boolean {
  return proration.workedWorkingDays >= proration.monthWorkingDays;
}

function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}

function minDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}

// THE definition of "currently employed", as a Prisma filter fragment. Open, or serving out
// a notice period.
//
// Use this rather than hand-writing `endDate: null` anywhere. Six sites once disagreed about
// this and the two that got it wrong were the ones that mattered: accrual stopped granting
// days the moment a future termination was recorded, and leave submission answered "not
// currently employed" to somebody the auth middleware had just admitted.
export function currentlyEmployedFilter(asOf: Date = new Date()) {
  const today = toUtcDay(asOf);
  return { OR: [{ endDate: null }, { endDate: { gte: today } }] };
}

export interface DateRange {
  start: Date;
  end: Date;
}

// The parts of [rangeStart, rangeEnd] the employee was actually employed for, as clipped
// segments. Normally one; two when someone was terminated and rehired inside the range.
//
// Everything dated must go through this before it reaches payroll. A leave record, an
// overtime entry or a reimbursement can sit outside the employment — most easily when a
// termination is recorded late, so records were filed for days the employee turns out not to
// have been employed for. Counting those deducts salary for days nobody was paid for, or pays
// overtime for a day after somebody left.
export function employmentSegments(
  employments: EmploymentLike[],
  rangeStart: Date,
  rangeEnd: Date,
): DateRange[] {
  const from = toUtcDay(rangeStart);
  const to = toUtcDay(rangeEnd);
  const segments: DateRange[] = [];

  for (const employment of employments) {
    const start = maxDate(toUtcDay(employment.startDate), from);
    const end =
      employment.endDate === null ? to : minDate(toUtcDay(employment.endDate), to);
    if (start > end) continue;
    segments.push({ start, end });
  }

  return segments.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Intersects one dated range with the employment segments, returning the parts that fall
// inside. An empty result means the range lies entirely outside the employment.
export function clipRangeToEmployments(
  start: Date,
  end: Date,
  employments: EmploymentLike[],
): DateRange[] {
  if (employments.length === 0) return [{ start, end }];
  return employmentSegments(employments, start, end);
}

// True when the date falls inside ANY of the employments. Used to drop point-dated records
// (overtime, daily logs, reimbursements) that sit outside them.
export function isEmployedOnAny(employments: EmploymentLike[], date: Date): boolean {
  // No employment information supplied means "do not filter", matching prorateMonth: absent
  // data must not silently delete somebody's overtime.
  if (employments.length === 0) return true;
  return employments.some((employment) => isEmployedOn(employment, date));
}

// The last month accrual should be granted for: the employment's end month, or null while it
// is still open. Accrual is granted per whole month, matching the existing rule that someone
// joining on the 30th earns that month's day.
export function accrualCutoffMonth(employment: Pick<EmploymentLike, 'endDate'>): Date | null {
  if (employment.endDate === null) return null;
  const end = toUtcDay(employment.endDate);
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
}
