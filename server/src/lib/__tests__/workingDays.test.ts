import { describe, expect, it } from 'vitest';
import { countWorkingDays } from '../workingDays';

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
