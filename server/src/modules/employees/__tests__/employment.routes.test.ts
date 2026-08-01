import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../app';
import { prisma } from '../../../config/prisma';
import {
  createAccrual,
  createEmployee,
  createEmployeeWithUser,
  createUser,
  currentEmployment,
  resetDb,
  signToken,
  TEST_PASSWORD,
  utc,
} from '../../../__tests__/helpers/factories';
import { ensureAccrualsUpToDate } from '../../../lib/accrual';

const API = '/api/v1/employees';

// Termination status is relative to "today", so now is pinned.
const NOW = new Date('2026-08-20T12:00:00.000Z');

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetDb();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function hrToken(): Promise<string> {
  const hr = await createUser({ roleName: 'HR' });
  return signToken(hr);
}

function terminatePayload(overrides: Record<string, unknown> = {}) {
  return { endDate: '2026-08-14', endReason: 'RESIGNATION', ...overrides };
}

describe('terminate — authorization', () => {
  it('rejects an unauthenticated terminate with 401', async () => {
    const employee = await createEmployee();
    const res = await request(app).post(`${API}/${employee.id}/terminate`).send(terminatePayload());
    expect(res.status).toBe(401);
  });

  it('forbids a non-HR employee from terminating anyone, including themselves (403)', async () => {
    const { employee, user } = await createEmployeeWithUser({ roleName: 'EMPLOYEE' });

    const res = await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send(terminatePayload());

    expect(res.status).toBe(403);
    // Assert stored state, not just the status: a 403 that still wrote would be worse.
    expect((await currentEmployment(employee.id)).endDate).toBeNull();
  });
});

describe('terminate', () => {
  it('closes the employment with the supplied date and reason', async () => {
    const employee = await createEmployee({ joinDate: utc('2026-01-01') });

    const res = await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(terminatePayload({ endNote: 'Moving abroad' }));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('TERMINATED');

    const employment = await currentEmployment(employee.id);
    expect(employment.endDate?.toISOString().slice(0, 10)).toBe('2026-08-14');
    expect(employment.endReason).toBe('RESIGNATION');
    expect(employment.endNote).toBe('Moving abroad');
  });

  it('accepts a future date and leaves the employee ACTIVE until it passes', async () => {
    const employee = await createEmployee({ joinDate: utc('2026-01-01') });

    const res = await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(terminatePayload({ endDate: '2026-09-30' }));

    expect(res.status).toBe(200);
    // A served notice period: the record is written now, the effect lands later.
    expect(res.body.status).toBe('ACTIVE');
    expect((await currentEmployment(employee.id)).endDate).not.toBeNull();
  });

  it('freezes the remaining leave balance onto the employment', async () => {
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      fullTimeSince: null, // no catch-up, so the balance is exactly what the test sets
    });
    await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 4,
      daysConsumed: 1.5,
    });

    await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(terminatePayload());

    const employment = await currentEmployment(employee.id);
    expect(Number(employment.leaveBalanceAtEnd)).toBe(2.5);
  });

  it('refuses to terminate twice', async () => {
    const employee = await createEmployee({ terminated: utc('2026-08-01') });

    const res = await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(terminatePayload());

    expect(res.status).toBe(409);
  });

  it('refuses a termination date before the employment started', async () => {
    const employee = await createEmployee({ joinDate: utc('2026-06-01') });

    const res = await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(terminatePayload({ endDate: '2026-05-01' }));

    expect(res.status).toBe(400);
    expect((await currentEmployment(employee.id)).endDate).toBeNull();
  });

  it('requires a reason', async () => {
    const employee = await createEmployee();

    const res = await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send({ endDate: '2026-08-14' });

    expect(res.status).toBe(400);
    expect((await currentEmployment(employee.id)).endDate).toBeNull();
  });
});

describe('terminate — access is revoked', () => {
  it('rejects a terminated employee on the very next request (401)', async () => {
    const { employee, user } = await createEmployeeWithUser({ roleName: 'EMPLOYEE' });
    const token = signToken(user);

    // The token works before termination...
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(terminatePayload());

    // ...and stops immediately afterwards, without waiting for it to expire.
    const after = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it('refuses a fresh LOGIN from a terminated employee, not just the token', async () => {
    // Rejecting only in the middleware would let login answer 200 with a token that fails on
    // the very next request — a sign-in that appears to work and then mysteriously does not.
    await createEmployeeWithUser({
      roleName: 'EMPLOYEE',
      userEmail: 'gone@example.test',
      terminated: utc('2026-08-14'),
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'gone@example.test', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('still lets a terminated employee be told nothing on a WRONG password', async () => {
    // The termination check must sit after the password check, or it becomes a probe for who
    // has left the company.
    await createEmployeeWithUser({
      roleName: 'EMPLOYEE',
      userEmail: 'gone2@example.test',
      terminated: utc('2026-08-14'),
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'gone2@example.test', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('still admits an employee whose termination date has not yet arrived', async () => {
    const { user } = await createEmployeeWithUser({
      roleName: 'EMPLOYEE',
      terminated: utc('2026-12-31'),
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(200);
  });

  it('admits an employee ON their last day', async () => {
    const { user } = await createEmployeeWithUser({
      roleName: 'EMPLOYEE',
      terminated: utc('2026-08-20'), // NOW
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(200);
  });

  it('does not lock out an HR account, which has no employee profile', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${await hrToken()}`);
    expect(res.status).toBe(200);
  });
});

describe('terminate — submissions stop', () => {
  it('refuses new leave from a terminated employee', async () => {
    const { employee, user } = await createEmployeeWithUser({
      roleName: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      terminated: utc('2026-08-14'),
    });
    await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 5,
    });

    // The middleware rejects first, which is the outcome that matters: no record is written.
    const res = await request(app)
      .post('/api/v1/leave')
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send({ type: 'PAID', startDate: '2026-08-24', endDate: '2026-08-25' });

    expect(res.status).toBe(401);
    await expect(prisma.leaveRequest.count({ where: { employeeId: employee.id } })).resolves.toBe(0);
  });
});

describe('rehire', () => {
  it('opens a new employment and leaves the old one untouched', async () => {
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      terminated: utc('2026-06-30'),
    });
    const previous = await currentEmployment(employee.id);

    const res = await request(app)
      .post(`${API}/${employee.id}/rehire`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send({ startDate: '2026-08-03' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.employments).toHaveLength(2);

    const untouched = await prisma.employment.findUniqueOrThrow({ where: { id: previous.id } });
    expect(untouched.endDate?.toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  it('starts leave from zero rather than backfilling the gap', async () => {
    // The bug this whole model exists to kill: before Employment, reactivating someone who
    // left a year ago minted a leave day for every month they had been away.
    const employee = await createEmployee({
      joinDate: utc('2025-01-01'),
      terminated: utc('2025-06-30'),
    });

    await request(app)
      .post(`${API}/${employee.id}/rehire`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send({ startDate: '2026-08-03' });

    await ensureAccrualsUpToDate(employee.id);

    const newEmployment = await currentEmployment(employee.id);
    const rows = await prisma.leaveAccrual.findMany({
      where: { employmentId: newEmployment.id },
      orderBy: { period: 'asc' },
    });

    // August 2026 only — not the fourteen months between leaving and returning.
    expect(rows).toHaveLength(1);
    expect(rows[0].period.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('reports the new engagement balance, not the previous one', async () => {
    const employee = await createEmployee({
      joinDate: utc('2025-01-01'),
      fullTimeSince: null,
      terminated: utc('2025-06-30'),
    });
    // Days earned under the old contract.
    await createAccrual({
      employeeId: employee.id,
      period: '2025-02-01',
      expiresAt: '2026-08-01',
      days: 5,
    });

    await request(app)
      .post(`${API}/${employee.id}/rehire`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send({ startDate: '2026-08-03' });

    const res = await request(app)
      .get('/api/v1/leave/balance')
      .set('Authorization', `Bearer ${await hrToken()}`)
      .query({ employeeId: employee.id });

    expect(res.status).toBe(200);
    // Exactly one day: August 2026, earned by the NEW engagement whose anchor is its own
    // start date. The five days from the previous contract are not carried over, and the
    // months between leaving and returning earn nothing.
    expect(res.body.balance).toBe(1);
    expect(res.body.accruedTotal).toBe(1);
  });

  it('refuses a rehire date on or before the previous end date', async () => {
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      terminated: utc('2026-06-30'),
    });

    const res = await request(app)
      .post(`${API}/${employee.id}/rehire`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send({ startDate: '2026-06-30' });

    expect(res.status).toBe(400);
    await expect(prisma.employment.count({ where: { employeeId: employee.id } })).resolves.toBe(1);
  });

  it('refuses to rehire somebody who is still employed', async () => {
    const employee = await createEmployee({ joinDate: utc('2026-01-01') });

    const res = await request(app)
      .post(`${API}/${employee.id}/rehire`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send({ startDate: '2026-08-03' });

    expect(res.status).toBe(409);
    await expect(prisma.employment.count({ where: { employeeId: employee.id } })).resolves.toBe(1);
  });

  it('is HR-only', async () => {
    const { employee, user } = await createEmployeeWithUser({
      roleName: 'EMPLOYEE',
      terminated: utc('2026-06-30'),
    });

    const res = await request(app)
      .post(`${API}/${employee.id}/rehire`)
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send({ startDate: '2026-08-03' });

    // A terminated employee's token is rejected before the role check even runs.
    expect([401, 403]).toContain(res.status);
    await expect(prisma.employment.count({ where: { employeeId: employee.id } })).resolves.toBe(1);
  });
});

describe('employee list — status filter', () => {
  it('separates active from terminated', async () => {
    await createEmployee({ fullName: 'Still Here' });
    await createEmployee({ fullName: 'Long Gone', terminated: utc('2026-06-30') });

    const token = await hrToken();
    const active = await request(app)
      .get(API)
      .set('Authorization', `Bearer ${token}`)
      .query({ status: 'ACTIVE' });
    const terminated = await request(app)
      .get(API)
      .set('Authorization', `Bearer ${token}`)
      .query({ status: 'TERMINATED' });

    expect(active.body.data.map((e: { fullName: string }) => e.fullName)).toEqual(['Still Here']);
    expect(terminated.body.data.map((e: { fullName: string }) => e.fullName)).toEqual(['Long Gone']);
  });

  it('lists everyone when no status filter is given', async () => {
    await createEmployee({ fullName: 'Still Here' });
    await createEmployee({ fullName: 'Long Gone', terminated: utc('2026-06-30') });

    const res = await request(app).get(API).set('Authorization', `Bearer ${await hrToken()}`);
    expect(res.body.total).toBe(2);
  });
});

// Regressions from review. NOW is pinned to 2026-08-20 at the top of this file.
describe('terminate — notice period and frozen balance', () => {
  it('keeps accruing leave through a notice period', async () => {
    // Recording a future termination must not stop the months still to be worked from
    // earning. Filtering accrual on `endDate: null` alone silently cost a day per month.
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      fullTimeSince: utc('2026-01-01'),
    });

    await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(terminatePayload({ endDate: '2026-12-31' }));

    await ensureAccrualsUpToDate(employee.id);

    const employment = await currentEmployment(employee.id);
    const rows = await prisma.leaveAccrual.count({ where: { employmentId: employment.id } });
    // January through August — the months actually worked so far, not zero.
    expect(rows).toBe(8);
  });

  it('lets an employee on notice still file leave', async () => {
    // Every other submission path allowed this; leave alone refused, because it demanded an
    // employment with a NULL end date rather than a current one.
    const { employee, user } = await createEmployeeWithUser({
      roleName: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      joinDate: utc('2026-01-01'),
      fullTimeSince: null,
      terminated: utc('2026-12-31'),
    });
    await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 5,
    });

    const res = await request(app)
      .post('/api/v1/leave')
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send({ type: 'PAID', startDate: '2026-08-24', endDate: '2026-08-25' });

    expect(res.status).toBe(201);
    await expect(prisma.leaveRequest.count({ where: { employeeId: employee.id } })).resolves.toBe(1);
  });

  it('freezes a balance that matches the rows left behind, not the rows before the trim', async () => {
    // Terminating effective 30 April on 20 August: Jan-Apr are earned, May-Aug were never
    // earned and are removed. Reading the balance before that delete recorded 8.
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      fullTimeSince: utc('2026-01-01'),
    });

    await request(app)
      .post(`${API}/${employee.id}/terminate`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(terminatePayload({ endDate: '2026-04-30' }));

    const employment = await currentEmployment(employee.id);
    const surviving = await prisma.leaveAccrual.findMany({
      where: { employmentId: employment.id },
    });
    const remaining = surviving.reduce(
      (total, row) => total + (Number(row.days) - Number(row.daysConsumed)),
      0,
    );

    expect(surviving).toHaveLength(4);
    expect(Number(employment.leaveBalanceAtEnd)).toBe(remaining);
    expect(Number(employment.leaveBalanceAtEnd)).toBe(4);
  });

  it('refuses a rehire anchor earlier than the rehire date', async () => {
    // Otherwise the new engagement mints a day for every month back to the anchor — the exact
    // bug that scoping accrual to an employment exists to prevent.
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      terminated: utc('2026-06-30'),
    });

    const res = await request(app)
      .post(`${API}/${employee.id}/rehire`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send({ startDate: '2026-08-03', fullTimeSince: '2019-01-01' });

    expect(res.status).toBe(400);
    await expect(prisma.employment.count({ where: { employeeId: employee.id } })).resolves.toBe(1);
  });
});

describe('records dated outside the employment', () => {
  it('refuses overtime dated after the last day, even while still on notice', async () => {
    // The employee is ACTIVE (notice runs to 31 Aug) and holds a valid token, so auth admits
    // them. Accepting a September entry would have it silently vanish: payroll selects by
    // employment overlap, so September excludes them entirely and the hours are never paid.
    const { employee, user } = await createEmployeeWithUser({
      roleName: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      joinDate: utc('2026-01-01'),
      terminated: utc('2026-08-31'),
    });

    const res = await request(app)
      .post('/api/v1/overtime')
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send({ date: '2026-09-10', hours: 4, description: 'after the end' });

    expect(res.status).toBe(400);
    await expect(prisma.overtime.count({ where: { employeeId: employee.id } })).resolves.toBe(0);
  });

  it('still accepts overtime dated inside the notice period', async () => {
    const { employee, user } = await createEmployeeWithUser({
      roleName: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      joinDate: utc('2026-01-01'),
      terminated: utc('2026-08-31'),
    });

    const res = await request(app)
      .post('/api/v1/overtime')
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send({ date: '2026-08-25', hours: 4, description: 'still employed' });

    expect(res.status).toBe(201);
    await expect(prisma.overtime.count({ where: { employeeId: employee.id } })).resolves.toBe(1);
  });
});

describe('editing an employee', () => {
  it('moves the first employment start date when the join date is corrected', async () => {
    // Everything downstream reads Employment.startDate. Left unsynced, the UI showed the
    // corrected date while payroll and accrual kept using the old one.
    const employee = await createEmployee({ joinDate: utc('2026-03-01') });

    const res = await request(app)
      .put(`${API}/${employee.id}`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send({
        fullName: 'Corrected Person',
        joinDate: '2026-01-15',
        position: 'Engineer',
        employmentType: 'FULL_TIME',
        monthlySalary: 10_000_000,
      });

    expect(res.status).toBe(200);
    const employment = await currentEmployment(employee.id);
    expect(employment.startDate.toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('refuses a join date after that employment already ended', async () => {
    const employee = await createEmployee({
      joinDate: utc('2026-01-01'),
      terminated: utc('2026-06-30'),
    });

    const res = await request(app)
      .put(`${API}/${employee.id}`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send({
        fullName: 'Impossible',
        joinDate: '2026-12-01',
        position: 'Engineer',
        employmentType: 'FULL_TIME',
        monthlySalary: 10_000_000,
      });

    expect(res.status).toBe(400);
    const employment = await currentEmployment(employee.id);
    expect(employment.startDate.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
});
