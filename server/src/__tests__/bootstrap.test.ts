import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { bootstrap } from '../../prisma/bootstrap';
import { prisma } from '../config/prisma';
import { createRole, createUser, resetDb } from './helpers/factories';

// prisma/bootstrap.ts is what makes the live instance reachable at all: with
// SEED_ON_START=false nothing else creates the HR and EMPLOYEE roles or a first
// account. It runs on every container start against real payroll data, so these
// assert on stored state — what rows exist afterwards, not what the call returned.
const HR_EMAIL = 'ayu@aisahub.com';
const HR_PASSWORD = 'bootstrap-password-1';

describe('bootstrap', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates both roles and exactly one HR user on an empty database', async () => {
    await bootstrap(prisma, { email: HR_EMAIL, password: HR_PASSWORD });

    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    expect(roles.map((role) => role.name)).toEqual(['EMPLOYEE', 'HR']);

    const users = await prisma.user.findMany({ include: { role: true } });
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe(HR_EMAIL);
    expect(users[0].role.name).toBe('HR');
    expect(users[0].isActive).toBe(true);
    await expect(bcrypt.compare(HR_PASSWORD, users[0].passwordHash)).resolves.toBe(true);
  });

  // Matches seed.ts:105 — HR operates the system, it is not somebody the system pays.
  it('creates no Employee record for the HR account', async () => {
    await bootstrap(prisma, { email: HR_EMAIL, password: HR_PASSWORD });

    expect(await prisma.employee.count()).toBe(0);
    expect(await prisma.employment.count()).toBe(0);
  });

  // The entrypoint runs this on every container start, restarts included.
  it('is idempotent — a second run leaves one user and two roles', async () => {
    await bootstrap(prisma, { email: HR_EMAIL, password: HR_PASSWORD });
    const first = await prisma.user.findFirstOrThrow();

    await bootstrap(prisma, { email: HR_EMAIL, password: HR_PASSWORD });

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.role.count()).toBe(2);
    const after = await prisma.user.findFirstOrThrow();
    expect(after.id).toBe(first.id);
    expect(after.passwordHash).toBe(first.passwordHash);
  });

  it('touches nothing when users already exist', async () => {
    await createRole('HR');
    await createRole('EMPLOYEE');
    const existing = await createUser({ roleName: 'HR', email: 'someone@aisahub.com' });

    await bootstrap(prisma, { email: HR_EMAIL, password: 'a-different-password' });

    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(existing.id);
    expect(users[0].email).toBe('someone@aisahub.com');
    expect(users[0].passwordHash).toBe(existing.passwordHash);
  });

  it('creates missing roles without touching existing users', async () => {
    // An EMPLOYEE-only database: the HR role is absent but somebody is registered.
    await createRole('EMPLOYEE');
    const existing = await createUser({ roleName: 'EMPLOYEE' });

    await bootstrap(prisma, { email: HR_EMAIL, password: HR_PASSWORD });

    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    expect(roles.map((role) => role.name)).toEqual(['EMPLOYEE', 'HR']);

    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(existing.id);
    expect(users[0].roleId).toBe(existing.roleId);
  });
});
