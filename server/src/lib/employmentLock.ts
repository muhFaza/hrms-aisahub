import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { HttpError } from './httpError';
import { isEmployedOn } from './employment';

// Somebody who has left cannot file new records. Call before any create that attributes a
// dated record to an employee, alongside assertPeriodEditable.
//
// The auth middleware already refuses a terminated employee's token, so in practice this
// guards two narrower cases: HR acting on behalf of an employee, and a termination that
// lands between a request being authenticated and the write being attempted. It is cheap and
// it means no submission path depends on the middleware having run.
//
// Before Employment existed this check had nowhere to live — Employee.isActive was read by
// payroll and accrual but by none of the submission paths, so a "deactivated" employee could
// still file leave, overtime, reimbursements and daily logs.
// `date` is the RECORD's date, not today. Checking only "employed right now" let somebody
// serving out a notice period file overtime and daily logs dated after their last day: the
// submission was accepted, and then payroll — which selects by employment overlap — dropped
// them from that month entirely, so the hours were never paid and surfaced nowhere. The same
// hole let records be backdated to before somebody started.
export async function assertEmployed(
  employeeId: number,
  date: Date,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  const employments = await client.employment.findMany({
    where: { employeeId },
    select: { startDate: true, endDate: true },
  });

  if (employments.length === 0) {
    throw new HttpError(400, 'This employee has no employment record');
  }
  if (!employments.some((employment) => isEmployedOn(employment, date))) {
    throw new HttpError(400, 'This employee was not employed on that date');
  }
}
