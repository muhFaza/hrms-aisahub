// Counts working days in [start, end] inclusive, excluding weekends and holidays.
// Pure and UTC-based so results are stable regardless of machine timezone.
// holidayDates are 'YYYY-MM-DD' keys (matching a UTC-midnight Holiday.date).
export function countWorkingDays(start: Date, end: Date, holidayDates: Iterable<string>): number {
  const holidays = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  let count = 0;
  while (cursor <= last) {
    const dayOfWeek = cursor.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const key = cursor.toISOString().slice(0, 10);
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(key)) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
