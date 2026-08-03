import type { Prisma } from '@prisma/client';
import { HttpError } from './httpError';

// Records inside a FINALIZED payroll range are immutable (design §4, Phase 5 locking).
// Call before any create/update/delete/review that touches a dated transactional record,
// passing the record's own date. @db.Date values arrive as UTC midnight, so read in UTC.
//
// Pass `client` to read through an open transaction, so a period cannot be finalized
// between the check and the write it guards.
interface LockedPayrollPeriod {
  year: number;
  month: number;
  startDate: Date;
  endDate: Date;
  status: string;
}

export async function assertPeriodRangeEditable(
  startDate: Date,
  endDate: Date,
  client: Prisma.TransactionClient,
): Promise<void> {
  // Lock every overlapping period, including drafts. Finalization takes an exclusive lock on
  // the same row, so a source-record mutation running inside this transaction either finishes
  // before payroll is computed or waits and then sees FINALIZED. Checking only finalized rows
  // would leave a race while a draft is being finalized.
  const periods = await client.$queryRaw<LockedPayrollPeriod[]>`
    SELECT "year", "month", "startDate", "endDate", "status"
    FROM "PayrollPeriod"
    WHERE "startDate" <= ${endDate}
      AND "endDate" >= ${startDate}
    FOR SHARE
  `;
  const period = periods.find((candidate) => candidate.status === 'FINALIZED');
  if (period) {
    const label = `${period.year}-${String(period.month).padStart(2, '0')}`;
    const start = period.startDate.toISOString().slice(0, 10);
    const end = period.endDate.toISOString().slice(0, 10);
    throw new HttpError(409, `Payroll period ${label} (${start} to ${end}) is finalized`);
  }
}

export async function assertPeriodEditable(
  date: Date,
  client: Prisma.TransactionClient,
): Promise<void> {
  await assertPeriodRangeEditable(date, date, client);
}
