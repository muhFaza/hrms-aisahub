import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { EmploymentType, HolidayType, LeaveType } from '@prisma/client';
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
  monthlySalary?: number;
  // Accrual anchor on the opening employment. Pass null explicitly to model someone the
  // catch-up must skip — that is how a test pins an exact set of accrual rows without also
  // making the employee unable to submit leave.
  fullTimeSince?: Date | null;
  // Ends the opening employment. `true` ends it yesterday; pass a Date to choose. This is
  // what replaced isActive: false — an employee is no longer switched off by a boolean.
  terminated?: boolean | Date;
  contractStartDate?: Date | null;
  contractEndDate?: Date | null;
}

export async function createEmployee(options: EmployeeOptions = {}) {
  const joinDate = options.joinDate ?? utc('2026-01-01');
  const employmentType = options.employmentType ?? 'FULL_TIME';
  // Mirrors what the employee service derives on create: full-timers are anchored at their
  // join date, part-timers have no anchor and accrue nothing.
  const fullTimeSince =
    options.fullTimeSince !== undefined
      ? options.fullTimeSince
      : employmentType === 'FULL_TIME'
        ? joinDate
        : null;

  const endDate =
    options.terminated === undefined || options.terminated === false
      ? null
      : options.terminated === true
        ? new Date(Date.now() - 24 * 60 * 60 * 1000)
        : options.terminated;

  return prisma.employee.create({
    data: {
      fullName: options.fullName ?? unique('Test Employee'),
      nickname: null,
      joinDate,
      position: 'Engineer',
      employmentType,
      email: options.email === undefined ? `${unique('employee')}@example.test` : options.email,
      monthlySalary: options.monthlySalary ?? 10_000_000,
      // Every employee opens with exactly one employment, exactly as the service does.
      employments: {
        create: {
          startDate: joinDate,
          endDate,
          endReason: endDate ? 'CONTRACT_END' : null,
          fullTimeSince,
          contractStartDate: options.contractStartDate ?? null,
          contractEndDate: options.contractEndDate ?? null,
        },
      },
    },
  });
}

// The employee's current employment — tests that assert on termination or accrual scoping
// need its id.
export async function currentEmployment(employeeId: number) {
  const employment = await prisma.employment.findFirst({
    where: { employeeId },
    orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { startDate: 'desc' }],
  });
  if (!employment) throw new Error(`no employment for employee ${employeeId}`);
  return employment;
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
//
// `email` is the EMPLOYEE's (the payslip address); `userEmail` is the login. They are
// separate columns and only the second one can be used to sign in, so a test that needs to
// hit /auth/login must set userEmail.
export async function createEmployeeWithUser(
  options: EmployeeOptions & {
    roleName?: string;
    isActive?: boolean;
    userEmail?: string;
  } = {},
) {
  const employee = await createEmployee(options);
  const user = await createUser({
    roleName: options.roleName ?? 'EMPLOYEE',
    employeeId: employee.id,
    isActive: options.isActive,
    email: options.userEmail,
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
  // Defaults to the employee's current employment, which is what every existing test means.
  employmentId?: number;
}

export async function createAccrual(options: AccrualOptions) {
  const employmentId =
    options.employmentId ?? (await currentEmployment(options.employeeId)).id;
  return prisma.leaveAccrual.create({
    data: {
      employeeId: options.employeeId,
      employmentId,
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
  reason?: string | null;
}

// A leave row is taken leave; it carries no status. Note this writes the row directly —
// it does not consume accrual the way submitLeave does.
export async function createLeaveRequest(options: LeaveRequestOptions) {
  return prisma.leaveRequest.create({
    data: {
      employeeId: options.employeeId,
      type: options.type ?? 'PAID',
      startDate: utc(options.startDate),
      endDate: utc(options.endDate),
      totalDays: options.totalDays,
      reason: options.reason ?? null,
    },
  });
}

// Defaults to NATIONAL, the type that actually suspends work. Pass 'JOINT_LEAVE' to model a
// cuti bersama, which employees work through.
export async function createHoliday(
  date: string,
  name = 'Test Holiday',
  type: HolidayType = 'NATIONAL',
) {
  return prisma.holiday.create({ data: { name, date: utc(date), type } });
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
