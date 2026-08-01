import { describe, expect, it } from 'vitest';
import {
  countHolidaysOnWeekdays,
  countWeekdays,
  countWeekendDays,
  countWorkingDays,
  isOffDayHoliday,
  offDayHolidayKeys,
} from '../workingDays';

// UTC-midnight date helper (matches how @db.Date rows are stored). July 2026 reference:
// 6th=Mon, 8th=Wed, 10th=Fri, 11th=Sat, 12th=Sun, 13th=Mon, 17th=Fri.
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('countWorkingDays', () => {
  it('counts a weekday-only span (Mon–Fri) as 5', () => {
    expect(countWorkingDays(d('2026-07-06'), d('2026-07-10'), [])).toBe(5);
  });

  it('excludes the weekend within a Mon–Sun span → 5', () => {
    expect(countWorkingDays(d('2026-07-06'), d('2026-07-12'), [])).toBe(5);
  });

  it('excludes a mid-week holiday (Wed) from a Mon–Fri span → 4', () => {
    expect(countWorkingDays(d('2026-07-06'), d('2026-07-10'), ['2026-07-08'])).toBe(4);
  });

  it('returns 0 for a single Saturday', () => {
    expect(countWorkingDays(d('2026-07-11'), d('2026-07-11'), [])).toBe(0);
  });

  it('does not double-subtract a holiday that falls on a weekend', () => {
    // Fri–Mon spans one weekend; a Saturday holiday must not reduce the 2 working days.
    expect(countWorkingDays(d('2026-07-10'), d('2026-07-13'), [])).toBe(2);
    expect(countWorkingDays(d('2026-07-10'), d('2026-07-13'), ['2026-07-11'])).toBe(2);
  });

  it('counts a multi-week span (two full work weeks) as 10', () => {
    expect(countWorkingDays(d('2026-07-06'), d('2026-07-17'), [])).toBe(10);
  });
});

// The off-day policy. JOINT_LEAVE (cuti bersama) is a working day: a holiday row exists so the
// calendar can show it, not to excuse attendance. Getting this wrong under-charges leave.
describe('offDayHolidayKeys — which holidays actually suspend work', () => {
  it.each(['NATIONAL', 'COMPANY', 'SPECIAL'])('treats %s as a day off', (holidayType) => {
    expect(isOffDayHoliday(holidayType)).toBe(true);
    expect(offDayHolidayKeys([{ date: d('2026-07-08'), type: holidayType }])).toEqual(
      new Set(['2026-07-08']),
    );
  });

  it('does not treat JOINT_LEAVE as a day off — employees work cuti bersama', () => {
    expect(isOffDayHoliday('JOINT_LEAVE')).toBe(false);
    expect(offDayHolidayKeys([{ date: d('2026-07-08'), type: 'JOINT_LEAVE' }]).size).toBe(0);
  });

  it('keeps only the off-day rows out of a mixed list', () => {
    const keys = offDayHolidayKeys([
      { date: d('2026-07-06'), type: 'NATIONAL' },
      { date: d('2026-07-07'), type: 'JOINT_LEAVE' },
      { date: d('2026-07-08'), type: 'COMPANY' },
    ]);
    expect(keys).toEqual(new Set(['2026-07-06', '2026-07-08']));
  });

  it('still counts a joint-leave day as a working day end to end', () => {
    const holidays = [{ date: d('2026-07-08'), type: 'JOINT_LEAVE' }];
    // Mon 6th - Fri 10th with a Wed cuti bersama: all five days are worked.
    expect(countWorkingDays(d('2026-07-06'), d('2026-07-10'), offDayHolidayKeys(holidays))).toBe(5);
  });

  it('drops a national holiday from the same span', () => {
    const holidays = [{ date: d('2026-07-08'), type: 'NATIONAL' }];
    expect(countWorkingDays(d('2026-07-06'), d('2026-07-10'), offDayHolidayKeys(holidays))).toBe(4);
  });
});

describe('countWeekdays / countWeekendDays', () => {
  it('splits July 2026 into 23 weekdays and 8 weekend days', () => {
    const start = d('2026-07-01');
    const end = d('2026-07-31');
    expect(countWeekdays(start, end)).toBe(23);
    expect(countWeekendDays(start, end)).toBe(8);
    expect(countWeekdays(start, end) + countWeekendDays(start, end)).toBe(31);
  });

  it('counts weekdays regardless of holidays, unlike countWorkingDays', () => {
    expect(countWeekdays(d('2026-07-06'), d('2026-07-10'))).toBe(5);
    expect(countWorkingDays(d('2026-07-06'), d('2026-07-10'), ['2026-07-08'])).toBe(4);
  });
});

describe('countHolidaysOnWeekdays', () => {
  const holidays = [
    { date: d('2026-07-08'), type: 'NATIONAL' }, // Wed
    { date: d('2026-07-11'), type: 'NATIONAL' }, // Sat
    { date: d('2026-07-09'), type: 'COMPANY' }, // Thu
    { date: d('2026-07-10'), type: 'JOINT_LEAVE' }, // Fri, worked
  ];
  const start = d('2026-07-01');
  const end = d('2026-07-31');

  it('counts only the requested types', () => {
    expect(countHolidaysOnWeekdays(holidays, ['NATIONAL'], start, end)).toBe(1);
    expect(countHolidaysOnWeekdays(holidays, ['COMPANY', 'SPECIAL'], start, end)).toBe(1);
  });

  it('ignores a holiday that falls on a weekend — it costs nobody a working day', () => {
    expect(countHolidaysOnWeekdays([holidays[1]], ['NATIONAL'], start, end)).toBe(0);
  });

  it('ignores a holiday outside the range', () => {
    expect(countHolidaysOnWeekdays(holidays, ['NATIONAL'], d('2026-08-01'), d('2026-08-31'))).toBe(0);
  });

  it('counts two rows on one date as a single lost working day', () => {
    const doubled = [
      { date: d('2026-07-08'), type: 'NATIONAL' },
      { date: d('2026-07-08'), type: 'NATIONAL' },
    ];
    expect(countHolidaysOnWeekdays(doubled, ['NATIONAL'], start, end)).toBe(1);
  });
});
