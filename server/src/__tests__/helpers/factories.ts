import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { EmploymentType, LeaveType, RequestStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import type { AuthUser } from '../../middleware/auth';

// Suites build the exact rows they assert on rather than leaning on prisma/seed.ts,
// so `pnpm test` is reproducible on a clean checkout and a failing test points at
// data defined a few lines above it.

// Unique-per-process suffix for columns with a UNIQUE constraint (User.email).
let sequence = 0;
function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

// bcryptjs at the default 10 rounds costs ~100ms per user; tests create many.
const BCRYPT_ROUNDS = 4;
export const TEST_PASSWORD = 'password123';

// Truncating every table (rather than deleting per-model in FK order) keeps this
// correct as the schema grows. RESTART IDENTITY makes sequence values predictable.
export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((row) => `"public"."${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function createRole(name: string): Promise<{ id: number; name: string }> {
  return prisma.role.upsert({
    where: { name },
    update: {},
    create: { name },
    select: { id: true, name: true },
  });
}

export interface EmployeeOptions {
  fullName?: string;
  employmentType?: EmploymentType;
  joinDate?: Date;
  email?: string | null;
  isActive?: boolean;
  monthlySalary?: number;
}

export async function createEmployee(options: EmployeeOptions = {}) {
  return prisma.employee.create({
    data: {
      fullName: options.fullName ?? unique('Test Employee'),
      nickname: null,
      joinDate: options.joinDate ?? utc('2026-01-01'),
      position: 'Engineer',
      employmentType: options.employmentType ?? 'FULL_TIME',
      email: options.email === undefined ? `${unique('employee')}@example.test` : options.email,
      isActive: options.isActive ?? true,
      monthlySalary: options.monthlySalary ?? 10_000_000,
    },
  });
}

export interface UserOptions {
  roleName?: string;
  employeeId?: number | null;
  email?: string;
  password?: string;
  isActive?: boolean;
}

export async function createUser(options: UserOptions = {}) {
  const role = await createRole(options.roleName ?? 'EMPLOYEE');
  return prisma.user.create({
    data: {
      email: options.email ?? `${unique('user')}@example.test`,
      passwordHash: bcrypt.hashSync(options.password ?? TEST_PASSWORD, BCRYPT_ROUNDS),
      roleId: role.id,
      employeeId: options.employeeId ?? null,
      isActive: options.isActive ?? true,
    },
    include: { role: true },
  });
}

// An employee profile plus the account linked to it — the common case.
export async function createEmployeeWithUser(
  options: EmployeeOptions & { roleName?: string; isActive?: boolean } = {},
) {
  const employee = await createEmployee(options);
  const user = await createUser({
    roleName: options.roleName ?? 'EMPLOYEE',
    employeeId: employee.id,
    isActive: options.isActive,
  });
  return { employee, user };
}

// Mirrors the payload src/modules/auth/service.ts signs on login.
export function signToken(
  user: { id: number; employeeId: number | null; role: { name: string } },
  overrides: Partial<jwt.SignOptions> = {},
): string {
  return jwt.sign(
    { userId: user.id, roleName: user.role.name, employeeId: user.employeeId ?? null },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, ...overrides } as jwt.SignOptions,
  );
}

export function authUser(user: {
  id: number;
  employeeId: number | null;
  role: { name: string };
}): AuthUser {
  return { userId: user.id, roleName: user.role.name, employeeId: user.employeeId ?? null };
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

export interface AccrualOptions {
  employeeId: number;
  period: string;
  expiresAt: string;
  days?: number;
  daysConsumed?: number;
}

export async function createAccrual(options: AccrualOptions) {
  return prisma.leaveAccrual.create({
    data: {
      employeeId: options.employeeId,
      period: utc(options.period),
      expiresAt: utc(options.expiresAt),
      days: options.days ?? 1,
      daysConsumed: options.daysConsumed ?? 0,
    },
  });
}

export interface LeaveRequestOptions {
  employeeId: number;
  startDate: string;
  endDate: string;
  totalDays: number;
  type?: LeaveType;
  status?: RequestStatus;
  reason?: string | null;
}

export async function createLeaveRequest(options: LeaveRequestOptions) {
  return prisma.leaveRequest.create({
    data: {
      employeeId: options.employeeId,
      type: options.type ?? 'PAID',
      startDate: utc(options.startDate),
      endDate: utc(options.endDate),
      totalDays: options.totalDays,
      status: options.status ?? 'PENDING',
      reason: options.reason ?? null,
    },
  });
}

export async function createHoliday(date: string, name = 'Test Holiday') {
  return prisma.holiday.create({ data: { name, date: utc(date), type: 'NATIONAL' } });
}

export async function finalizePeriod(year: number, month: number, finalizedById: number) {
  return prisma.payrollPeriod.create({
    data: {
      year,
      month,
      exchangeRate: 16_000,
      status: 'FINALIZED',
      finalizedById,
      finalizedAt: new Date(),
    },
  });
}

// @db.Date columns are stored at UTC midnight; the services compare against that.
export function utc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}
