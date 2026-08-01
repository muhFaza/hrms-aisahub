import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { EmployeeInput, ListEmployeesQuery } from './schemas';

export async function listEmployees(query: ListEmployeesQuery) {
  const where: Prisma.EmployeeWhereInput = {};
  if (query.employmentType) where.employmentType = query.employmentType;
  if (query.isActive !== undefined) where.isActive = query.isActive;
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
      orderBy: { fullName: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.employee.count({ where }),
  ]);

  return { data, total, page: query.page, pageSize: query.pageSize };
}

export async function getEmployee(id: number) {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }
  return employee;
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
// `existing` is undefined on create. The joinDate fallback only fires for a full-timer whose
// anchor is missing — an invalid state the backfill migration rules out — and reproduces the
// pre-anchor behaviour rather than silently accruing nothing.
function resolveFullTimeSince(
  input: EmployeeInput,
  existing?: { employmentType: string; fullTimeSince: Date | null },
): Date | null {
  // Employment type is checked first: a part-timer never carries an anchor, whatever the
  // request body said. The client hides the field for them, but the server cannot rely on it.
  if (input.employmentType !== 'FULL_TIME') return null;
  if (input.fullTimeSince) return toUtcMidnight(input.fullTimeSince);
  if (!existing) return toUtcMidnight(input.joinDate);
  if (existing.employmentType !== 'FULL_TIME') return utcToday();
  return existing.fullTimeSince ?? toUtcMidnight(input.joinDate);
}

// Maps validated input to Prisma data; optional fields collapse undefined → null.
function buildData(
  input: EmployeeInput,
  fullTimeSince: Date | null,
): Prisma.EmployeeUncheckedCreateInput {
  return {
    fullName: input.fullName,
    nickname: input.nickname ?? null,
    joinDate: input.joinDate,
    position: input.position,
    employmentType: input.employmentType,
    fullTimeSince,
    contractStartDate: input.contractStartDate ?? null,
    contractEndDate: input.contractEndDate ?? null,
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
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
}

export async function createEmployee(input: EmployeeInput) {
  return prisma.employee.create({ data: buildData(input, resolveFullTimeSince(input)) });
}

export async function updateEmployee(id: number, input: EmployeeInput) {
  const existing = await getEmployee(id);
  return prisma.employee.update({
    where: { id },
    data: buildData(input, resolveFullTimeSince(input, existing)),
  });
}

// No hard delete (design §5) — deactivate instead by setting isActive on update.
export async function setContractFile(id: number, filePath: string) {
  await getEmployee(id);
  return prisma.employee.update({ where: { id }, data: { contractFilePath: filePath } });
}
