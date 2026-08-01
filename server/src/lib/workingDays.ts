// Working-day arithmetic and the company's off-day policy. Pure and UTC-based so results are
// stable regardless of machine timezone.

// Which holiday types are actually days off.
//
// JOINT_LEAVE (cuti bersama) is deliberately NOT here: employees work those days. A holiday
// row of that type exists so the calendar can show it, not to excuse attendance. Counting it
// as a day off used to under-charge leave — someone whose sick leave spanned the three Idul
// Fitri cuti bersama days had those days deducted from nobody.
//
// NATIONAL, COMPANY and SPECIAL are days off for everyone, and nobody is deducted for them.
const OFF_DAY_HOLIDAY_TYPES = new Set(['NATIONAL', 'COMPANY', 'SPECIAL']);

export interface HolidayLike {
  date: Date;
  type: string;
}

export function isOffDayHoliday(type: string): boolean {
  return OFF_DAY_HOLIDAY_TYPES.has(type);
}

export function toDateKey(value: HolidayLike | Date): string {
  const date = value instanceof Date ? value : value.date;
  return date.toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' keys for the holidays that actually suspend work. Every caller of
// countWorkingDays must go through this rather than mapping Holiday rows directly, or the
// joint-leave policy silently reverts.
export function offDayHolidayKeys(holidays: HolidayLike[]): Set<string> {
  return new Set(holidays.filter((holiday) => isOffDayHoliday(holiday.type)).map(toDateKey));
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function eachDay(start: Date, end: Date, visit: (date: Date) => void): void {
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last) {
    visit(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

// Counts working days in [start, end] inclusive, excluding weekends and off-day holidays.
// holidayDates are 'YYYY-MM-DD' keys (matching a UTC-midnight Holiday.date) and must come
// from offDayHolidayKeys.
export function countWorkingDays(start: Date, end: Date, holidayDates: Iterable<string>): number {
  const holidays = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  let count = 0;
  eachDay(start, end, (date) => {
    if (!isWeekend(date) && !holidays.has(toDateKey(date))) {
      count += 1;
    }
  });
  return count;
}

// Weekdays in [start, end] regardless of holidays — the days an employee is scheduled to be at
// work before any holiday or leave is taken off them.
export function countWeekdays(start: Date, end: Date): number {
  let count = 0;
  eachDay(start, end, (date) => {
    if (!isWeekend(date)) count += 1;
  });
  return count;
}

export function countWeekendDays(start: Date, end: Date): number {
  let count = 0;
  eachDay(start, end, (date) => {
    if (isWeekend(date)) count += 1;
  });
  return count;
}

// Holidays of the given types that land on a weekday within [start, end]. A holiday falling on
// a Saturday is not counted: it would double-count against the weekend total and costs nobody a
// working day. Two rows on one date are one lost working day, hence the Set.
export function countHolidaysOnWeekdays(
  holidays: HolidayLike[],
  types: string[],
  start: Date,
  end: Date,
): number {
  const wanted = new Set(types);
  const seen = new Set<string>();
  for (const holiday of holidays) {
    if (!wanted.has(holiday.type)) continue;
    if (holiday.date < start || holiday.date > end) continue;
    if (isWeekend(holiday.date)) continue;
    seen.add(toDateKey(holiday));
  }
  return seen.size;
}
