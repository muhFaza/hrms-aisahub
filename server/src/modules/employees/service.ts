import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import {
  currentlyEmployedFilter,
  employmentStatusAsOf,
  type EmploymentStatus,
} from '../../lib/employment';
import { ensureAccrualsUpToDate } from '../../lib/accrual';
import { resolveGroup } from '../notifications/emit';
import type {
  EmployeeInput,
  ListEmployeesQuery,
  RehireInput,
  TerminateInput,
} from './schemas';

// Ordering that puts the open employment first, then the most recently ended. "The current
// employment" means the first row of this ordering, everywhere in this module.
const currentFirst: Prisma.EmploymentOrderByWithRelationInput[] = [
  { endDate: { sort: 'desc', nulls: 'first' } },
  { startDate: 'desc' },
];

const employeeInclude = Prisma.validator<Prisma.EmployeeInclude>()({
  employments: { orderBy: currentFirst },
});

type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

// The client still receives contract dates and the accrual anchor as flat fields on the
// employee — they simply come from the current employment now. `employments` carries the
// full history for the audit view, and `status`/`terminationDate` are derived.
function serializeEmployee(employee: EmployeeRow) {
  const current = employee.employments[0] ?? null;
  const status: EmploymentStatus = employmentStatusAsOf(current, new Date());
  const { employments, ...rest } = employee;

  return {
    ...rest,
    status,
    terminationDate: current?.endDate ?? null,
    contractStartDate: current?.contractStartDate ?? null,
    contractEndDate: current?.contractEndDate ?? null,
    contractFilePath: current?.contractFilePath ?? null,
    fullTimeSince: current?.fullTimeSince ?? null,
    employments: employments.map((employment) => ({
      id: employment.id,
      startDate: employment.startDate,
      endDate: employment.endDate,
      endReason: employment.endReason,
      endNote: employment.endNote,
      contractStartDate: employment.contractStartDate,
      contractEndDate: employment.contractEndDate,
      contractFilePath: employment.contractFilePath,
      fullTimeSince: employment.fullTimeSince,
      leaveBalanceAtEnd:
        employment.leaveBalanceAtEnd === null ? null : Number(employment.leaveBalanceAtEnd),
      recordedById: employment.recordedById,
      createdAt: employment.createdAt,
    })),
  };
}

export async function listEmployees(query: ListEmployeesQuery) {
  const where: Prisma.EmployeeWhereInput = {};
  if (query.employmentType) where.employmentType = query.employmentType;

  // Status is derived, so it is filtered structurally: currently employed means an open
  // employment, or one whose end date has not yet passed.
  if (query.status === 'ACTIVE') {
    where.employments = { some: currentlyEmployedFilter() };
  } else if (query.status === 'TERMINATED') {
    where.employments = { none: currentlyEmployedFilter() };
  }

  if (query.search) {
    where.OR = [
      { fullName: { contains: query.search, mode: 'insensitive' } },
      { nickname: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: employeeInclude,
      orderBy: { fullName: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.employee.count({ where }),
  ]);

  return { data: data.map(serializeEmployee), total, page: query.page, pageSize: query.pageSize };
}

export async function getEmployee(id: number) {
  const employee = await prisma.employee.findUnique({ where: { id }, include: employeeInclude });
  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }
  return serializeEmployee(employee);
}

// Raw row plus its current employment — for callers that need the record rather than the
// serialized shape (the contract upload and download handlers).
export async function getEmployeeWithCurrentEmployment(id: number) {
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { employments: { orderBy: currentFirst, take: 1 } },
  });
  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }
  return { employee, current: employee.employments[0] ?? null };
}

// Calendar days are written at UTC midnight so accrual period membership is stable on any
// non-UTC machine. ensureAccrualsUpToDate takes startOf('month') in server-local time, so a
// stored anchor carrying a time component can land in the wrong month.
function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcToday(): Date {
  return toUtcMidnight(new Date());
}

// The accrual anchor. An explicitly supplied date always wins — that is HR's correction path
// for a conversion recorded late. Otherwise it is derived from the employmentType transition:
// becoming full-time anchors accrual at today, leaving full-time clears it, and an update
// that does not change employmentType must preserve whatever is already stored.
//
// `existing` is undefined when opening a new employment. The fallback anchors at the
// employment's own start date, never the employee's original joinDate — that distinction is
// what stops a rehire accruing for the months the person was away.
function resolveFullTimeSince(
  input: { employmentType: string; fullTimeSince?: Date | null },
  employmentStart: Date,
  existing?: { employmentType: string; fullTimeSince: Date | null },
): Date | null {
  // Employment type is checked first: a part-timer never carries an anchor, whatever the
  // request body said. The client hides the field for them, but the server cannot rely on it.
  if (input.employmentType !== 'FULL_TIME') return null;
  if (input.fullTimeSince) return toUtcMidnight(input.fullTimeSince);
  if (!existing) return toUtcMidnight(employmentStart);
  if (existing.employmentType !== 'FULL_TIME') return utcToday();
  return existing.fullTimeSince ?? toUtcMidnight(employmentStart);
}

// Employee identity and pay fields. The dated contract facts live on Employment.
function buildEmployeeData(input: EmployeeInput): Prisma.EmployeeUncheckedCreateInput {
  return {
    fullName: input.fullName,
    nickname: input.nickname ?? null,
    joinDate: input.joinDate,
    position: input.position,
    employmentType: input.employmentType,
    monthlySalary: input.monthlySalary ?? null,
    hourlyRate: input.hourlyRate ?? null,
    email: input.email ?? null,
    university: input.university ?? null,
    major: input.major ?? null,
    graduationYear: input.graduationYear ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    religion: input.religion ?? null,
    thrEligible: input.thrEligible ?? false,
    bankName: input.bankName ?? null,
    bankAccountNumber: input.bankAccountNumber ?? null,
    ktpNumber: input.ktpNumber ?? null,
    phoneNumber: input.phoneNumber ?? null,
  };
}

export async function createEmployee(input: EmployeeInput, actorUserId: number) {
  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.create({ data: buildEmployeeData(input) });
    // Every employee opens with exactly one employment. Nothing in the system can express an
    // employee who has never been employed, which is what lets status derive unambiguously.
    await tx.employment.create({
      data: {
        employeeId: employee.id,
        startDate: toUtcMidnight(input.joinDate),
        contractStartDate: input.contractStartDate ?? null,
        contractEndDate: input.contractEndDate ?? null,
        fullTimeSince: resolveFullTimeSince(input, input.joinDate),
        recordedById: actorUserId,
      },
    });
    return employee.id;
  });

  return getEmployee(created);
}

export async function updateEmployee(id: number, input: EmployeeInput, actorUserId: number) {
  const { employee, current } = await getEmployeeWithCurrentEmployment(id);
  if (!current) {
    throw new HttpError(409, 'Employee has no employment record');
  }
  // Captured BEFORE the update: resolveFullTimeSince detects a conversion by comparing the
  // incoming employment type against the stored one, so passing the incoming value for both
  // would make every update look like "no change" and silently skip re-anchoring.
  const previousEmploymentType = employee.employmentType;

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${id} FOR UPDATE`;
    await tx.employee.update({ where: { id }, data: buildEmployeeData(input) });

    // joinDate and the FIRST employment's startDate describe the same event, so correcting
    // one has to move the other. Left unsynced, the UI showed the corrected date while every
    // payroll and accrual query — all of which read startDate — kept using the old one.
    //
    // Only the earliest employment: after a rehire, joinDate is the original first join and
    // the current employment's startDate is the rehire date, and those legitimately differ.
    const earliest = await tx.employment.findFirst({
      where: { employeeId: id },
      orderBy: { startDate: 'asc' },
      select: { id: true, endDate: true },
    });
    if (earliest) {
      const newStart = toUtcMidnight(input.joinDate);
      if (earliest.endDate && newStart > toUtcMidnight(earliest.endDate)) {
        throw new HttpError(400, 'Join date cannot be after that employment ended');
      }
      await tx.employment.update({ where: { id: earliest.id }, data: { startDate: newStart } });
    }
    // The contract window and anchor belong to the employment being edited — the current one.
    // Editing a terminated employee's record updates their last employment, which is what HR
    // correcting a historical mistake expects.
    await tx.employment.update({
      where: { id: current.id },
      data: {
        contractStartDate: input.contractStartDate ?? null,
        contractEndDate: input.contractEndDate ?? null,
        fullTimeSince: resolveFullTimeSince(input, current.startDate, {
          employmentType: previousEmploymentType,
          fullTimeSince: current.fullTimeSince,
        }),
        recordedById: actorUserId,
      },
    });
  });

  return getEmployee(id);
}

// Ends the current employment.
//
// The effective date is HR's to choose and may be in the past (a termination recorded late)
// or the future (a served notice period). It is NOT forced to match contractEndDate — that is
// the whole point of it being overridable, since somebody can leave before their contract
// runs out or stay past it.
export async function terminateEmployee(
  id: number,
  input: TerminateInput,
  actorUserId: number,
): Promise<ReturnType<typeof getEmployee>> {
  const endDate = toUtcMidnight(input.endDate);

  // Bring accrual up to date BEFORE the transaction, so a termination recorded after a month
  // rolled over still credits the months actually worked before the balance is frozen.
  await ensureAccrualsUpToDate(id);

  await prisma.$transaction(async (tx) => {
    // Same serialization idiom submitLeave uses. The guard and the write have to sit inside
    // one transaction behind this lock: read outside it and two concurrent terminates both
    // pass the "not already terminated" check, both write, and the first HR user is told 200
    // while their date and reason are silently overwritten.
    await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${id} FOR UPDATE`;

    const current = await tx.employment.findFirst({
      where: { employeeId: id },
      orderBy: currentFirst,
    });
    if (!current) {
      throw new HttpError(409, 'Employee has no employment record');
    }
    if (current.endDate !== null) {
      throw new HttpError(409, 'This employee has already been terminated');
    }
    if (endDate < toUtcMidnight(current.startDate)) {
      throw new HttpError(400, 'Termination date cannot be before the employment started');
    }
    // Accrual months granted beyond the termination month were never earned — this only
    // happens when a termination is recorded late. Unconsumed rows are removed; a row with
    // days already spent is left alone, because deleting it would strand a leave record that
    // drew from it. Those are surfaced to HR rather than silently rewritten.
    const cutoff = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
    await tx.leaveAccrual.deleteMany({
      where: { employmentId: current.id, period: { gt: cutoff }, daysConsumed: 0 },
    });

    // Frozen AFTER the delete, and computed from the rows that actually survive it.
    // Reading it beforehand recorded days that were removed a moment later: terminating
    // effective 30 April on 2 August froze a balance of 8 while only 4 rows remained — the
    // figure over-reported by exactly the months between the effective date and the entry
    // date. It is the number HR would settle a final payment against, so it has to match.
    const surviving = await tx.leaveAccrual.findMany({
      where: { employmentId: current.id },
      select: { days: true, daysConsumed: true, expiresAt: true },
    });
    const now = new Date();
    const balance = surviving.reduce(
      (total, row) =>
        row.expiresAt <= now
          ? total
          : total + (Number(row.days) - Number(row.daysConsumed)),
      0,
    );

    // A contract-end reminder for this employment has served its purpose the moment HR acts
    // on it. Nothing else resolves an EMPLOYMENT group, so without this the reminder can only
    // ever be marked read, never cleared — and the catch-up would re-emit it on the next
    // fetch if a dismiss action were ever added.
    await resolveGroup(tx, 'EMPLOYMENT', current.id, actorUserId);

    await tx.employment.update({
      where: { id: current.id },
      data: {
        endDate,
        endReason: input.endReason,
        endNote: input.endNote ?? null,
        // Recorded, then forfeited rather than paid out — see the design doc.
        leaveBalanceAtEnd: new Prisma.Decimal(balance),
        recordedById: actorUserId,
      },
    });
  });

  return getEmployee(id);
}

// Opens a new employment for someone who has left.
//
// Deliberately a new row rather than reopening the old one: the previous engagement's dates,
// contract and accrual stay exactly as they were, and the new engagement starts with no leave
// balance at all. Reopening would resurrect the old accrual rows and hand back days earned
// under a contract that has ended.
export async function rehireEmployee(id: number, input: RehireInput, actorUserId: number) {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }

  const startDate = toUtcMidnight(input.startDate);
  // An anchor before the new start date would mint a leave day for every month back to it —
  // reopening, on the rehire path, the exact bug that scoping accrual to an employment fixed.
  if (input.fullTimeSince && toUtcMidnight(input.fullTimeSince) < startDate) {
    throw new HttpError(400, 'Full-time since cannot be before the rehire date');
  }

  await prisma.$transaction(async (tx) => {
    // Read-check-write behind the same lock the rest of the module uses. Without it, two
    // concurrent rehires both saw a closed employment and both inserted; only the partial
    // unique index stopped the corruption, and the loser got a raw
    // "Unique constraint violation" leaking the index name instead of the 409 below.
    await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${id} FOR UPDATE`;

    const previous = await tx.employment.findFirst({
      where: { employeeId: id },
      orderBy: currentFirst,
    });
    if (!previous) {
      throw new HttpError(409, 'Employee has no employment record');
    }
    if (previous.endDate === null) {
      throw new HttpError(409, 'This employee is already employed');
    }
    // A new engagement must begin after the previous one ended. Overlapping employments would
    // double-count working days in payroll proration, which sums across them.
    if (startDate <= toUtcMidnight(previous.endDate)) {
      throw new HttpError(400, 'Rehire date must be after the previous employment ended');
    }

    await tx.employment.create({
      data: {
        employeeId: id,
        startDate,
        contractStartDate: input.contractStartDate ?? null,
        contractEndDate: input.contractEndDate ?? null,
        fullTimeSince: resolveFullTimeSince(
          { employmentType: employee.employmentType, fullTimeSince: input.fullTimeSince },
          startDate,
        ),
        recordedById: actorUserId,
      },
    });
  });

  return getEmployee(id);
}

// No hard delete (design §5) — an employee who has left is terminated, not removed.
export async function setContractFile(id: number, filePath: string) {
  const { current } = await getEmployeeWithCurrentEmployment(id);
  if (!current) {
    throw new HttpError(409, 'Employee has no employment record');
  }
  // The file belongs to the employment it was signed for, so a rehire's contract never
  // overwrites the previous engagement's document.
  await prisma.employment.update({ where: { id: current.id }, data: { contractFilePath: filePath } });
  return getEmployee(id);
}
