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

// Maps validated input to Prisma data; optional fields collapse undefined → null.
function buildData(input: EmployeeInput): Prisma.EmployeeUncheckedCreateInput {
  return {
    fullName: input.fullName,
    nickname: input.nickname ?? null,
    joinDate: input.joinDate,
    position: input.position,
    employmentType: input.employmentType,
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
  return prisma.employee.create({ data: buildData(input) });
}

export async function updateEmployee(id: number, input: EmployeeInput) {
  await getEmployee(id);
  return prisma.employee.update({ where: { id }, data: buildData(input) });
}

// No hard delete (design §5) — deactivate instead by setting isActive on update.
export async function setContractFile(id: number, filePath: string) {
  await getEmployee(id);
  return prisma.employee.update({ where: { id }, data: { contractFilePath: filePath } });
}
