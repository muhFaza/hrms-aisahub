import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { HttpError } from './httpError';

// Records inside a FINALIZED payroll month are immutable (design §4, Phase 5 locking).
// Call before any create/update/delete/review that touches a dated transactional record,
// passing the record's own date. @db.Date values arrive as UTC midnight, so read in UTC.
//
// Pass `client` to read through an open transaction, so a period cannot be finalized
// between the check and the write it guards.
export async function assertPeriodEditable(
  date: Date,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const period = await client.payrollPeriod.findUnique({
    where: { year_month: { year, month } },
  });
  if (period?.status === 'FINALIZED') {
    const label = `${year}-${String(month).padStart(2, '0')}`;
    throw new HttpError(409, `Payroll period ${label} is finalized`);
  }
}
