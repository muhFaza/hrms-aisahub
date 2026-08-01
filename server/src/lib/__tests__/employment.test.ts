import { describe, expect, it } from 'vitest';
import {
  employmentStatusAsOf,
  isEmployedOn,
  isFullMonth,
  prorateMonth,
} from '../employment';

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// August 2026 has 21 weekdays (the 1st is a Saturday); September 2026 has 22 and February
// 2026 has 20. Three different month lengths, so proration is not accidentally tuned to one.
const AUG_START = utc('2026-08-01');
const AUG_END = utc('2026-08-31');
const NO_HOLIDAYS = new Set<string>();

describe('employmentStatusAsOf', () => {
  it('is ACTIVE while the employment is open', () => {
    const employment = { startDate: utc('2026-01-01'), endDate: null };
    expect(employmentStatusAsOf(employment, utc('2030-01-01'))).toBe('ACTIVE');
  });

  it('is ACTIVE ON the end date itself — the last day is worked and paid', () => {
    const employment = { startDate: utc('2026-01-01'), endDate: utc('2026-08-14') };
    expect(employmentStatusAsOf(employment, utc('2026-08-14'))).toBe('ACTIVE');
  });

  it('is TERMINATED the day after the end date', () => {
    const employment = { startDate: utc('2026-01-01'), endDate: utc('2026-08-14') };
    expect(employmentStatusAsOf(employment, utc('2026-08-15'))).toBe('TERMINATED');
  });

  it('is still ACTIVE when the end date is in the future — a served notice period', () => {
    const employment = { startDate: utc('2026-01-01'), endDate: utc('2026-12-31') };
    expect(employmentStatusAsOf(employment, utc('2026-08-14'))).toBe('ACTIVE');
  });

  it('treats a missing employment as TERMINATED, not ACTIVE', () => {
    // Corrupt data should deny access rather than grant it. Every employee has an employment
    // after the backfill migration, so this only fires on a broken row.
    expect(employmentStatusAsOf(null, utc('2026-08-14'))).toBe('TERMINATED');
    expect(employmentStatusAsOf(undefined, utc('2026-08-14'))).toBe('TERMINATED');
  });

  it('ignores a time component on the end date', () => {
    const employment = {
      startDate: utc('2026-01-01'),
      endDate: new Date('2026-08-14T23:59:59.000Z'),
    };
    expect(employmentStatusAsOf(employment, new Date('2026-08-14T01:00:00.000Z'))).toBe('ACTIVE');
    expect(employmentStatusAsOf(employment, new Date('2026-08-15T01:00:00.000Z'))).toBe(
      'TERMINATED',
    );
  });
});

describe('isEmployedOn', () => {
  const employment = { startDate: utc('2026-08-03'), endDate: utc('2026-08-14') };

  it('includes both boundary days', () => {
    expect(isEmployedOn(employment, utc('2026-08-03'))).toBe(true);
    expect(isEmployedOn(employment, utc('2026-08-14'))).toBe(true);
  });

  it('excludes the days either side', () => {
    expect(isEmployedOn(employment, utc('2026-08-02'))).toBe(false);
    expect(isEmployedOn(employment, utc('2026-08-15'))).toBe(false);
  });
});

describe('prorateMonth', () => {
  it('pays a full month when the employment spans it', () => {
    const result = prorateMonth({
      employments: [{ startDate: utc('2020-01-01'), endDate: null }],
      monthStart: AUG_START,
      monthEnd: AUG_END,
      holidayKeys: NO_HOLIDAYS,
    });

    expect(result.monthWorkingDays).toBe(21);
    expect(result.workedWorkingDays).toBe(21);
    expect(result.factor).toBe(1);
    expect(isFullMonth(result)).toBe(true);
  });

  it('prorates a mid-month termination on the working days actually worked', () => {
    // Terminated on the 14th: 10 of August's 21 weekdays fall on or before it.
    const result = prorateMonth({
      employments: [{ startDate: utc('2020-01-01'), endDate: utc('2026-08-14') }],
      monthStart: AUG_START,
      monthEnd: AUG_END,
      holidayKeys: NO_HOLIDAYS,
    });

    expect(result.workedWorkingDays).toBe(10);
    expect(result.monthWorkingDays).toBe(21);
    expect(result.factor).toBeCloseTo(10 / 21);
    expect(isFullMonth(result)).toBe(false);
  });

  it('prorates a mid-month joiner the same way', () => {
    const result = prorateMonth({
      employments: [{ startDate: utc('2026-08-17'), endDate: null }],
      monthStart: AUG_START,
      monthEnd: AUG_END,
      holidayKeys: NO_HOLIDAYS,
    });

    expect(result.workedWorkingDays).toBe(11);
    expect(result.factor).toBeCloseTo(11 / 21);
  });

  it('pays a full month when termination lands on the last working day', () => {
    // The boundary that a naive worked/21 formula gets wrong in a 20-working-day month.
    const result = prorateMonth({
      employments: [{ startDate: utc('2020-01-01'), endDate: utc('2026-02-27') }],
      monthStart: utc('2026-02-01'),
      monthEnd: utc('2026-02-28'),
      holidayKeys: NO_HOLIDAYS,
    });

    expect(result.monthWorkingDays).toBe(20);
    expect(result.workedWorkingDays).toBe(20);
    expect(result.factor).toBe(1);
  });

  it('never exceeds a full month in a 22-working-day month', () => {
    const result = prorateMonth({
      employments: [{ startDate: utc('2020-01-01'), endDate: null }],
      monthStart: utc('2026-09-01'),
      monthEnd: utc('2026-09-30'),
      holidayKeys: NO_HOLIDAYS,
    });

    expect(result.monthWorkingDays).toBe(22);
    expect(result.factor).toBe(1);
  });

  it('sums both segments when someone is terminated and rehired in one month', () => {
    const result = prorateMonth({
      employments: [
        { startDate: utc('2020-01-01'), endDate: utc('2026-08-14') },
        { startDate: utc('2026-08-17'), endDate: null },
      ],
      monthStart: AUG_START,
      monthEnd: AUG_END,
      holidayKeys: NO_HOLIDAYS,
    });

    // 10 + 11 = the whole month, so the gap over the weekend costs nothing.
    expect(result.workedWorkingDays).toBe(21);
    expect(result.factor).toBe(1);
  });

  it('excludes off-day holidays from both sides of the ratio', () => {
    const result = prorateMonth({
      employments: [{ startDate: utc('2020-01-01'), endDate: utc('2026-08-14') }],
      monthStart: AUG_START,
      monthEnd: AUG_END,
      holidayKeys: new Set(['2026-08-17']), // a Monday, outside the worked range
    });

    expect(result.monthWorkingDays).toBe(20);
    expect(result.workedWorkingDays).toBe(10);
  });

  it('ignores an employment that does not touch the month', () => {
    const result = prorateMonth({
      employments: [{ startDate: utc('2020-01-01'), endDate: utc('2025-01-01') }],
      monthStart: AUG_START,
      monthEnd: AUG_END,
      holidayKeys: NO_HOLIDAYS,
    });

    expect(result.workedWorkingDays).toBe(0);
    expect(result.factor).toBe(0);
  });

  it('does not prorate when no employment information is supplied', () => {
    // Absent data must mean "full month", never "pay nothing" — a zero payslip for an active
    // employee is a far worse failure than the unprorated month this used to pay.
    const result = prorateMonth({
      employments: [],
      monthStart: AUG_START,
      monthEnd: AUG_END,
      holidayKeys: NO_HOLIDAYS,
    });

    expect(result.factor).toBe(1);
    expect(result.workedWorkingDays).toBe(21);
  });
});
