import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../app';
import { prisma } from '../../../config/prisma';
import {
  createAccrual,
  createEmployee,
  createEmployeeWithUser,
  createLeaveRequest,
  createUser,
  resetDb,
  signToken,
} from '../../../__tests__/helpers/factories';

vi.mock('../../../lib/email', () => ({
  sendLeaveSubmittedEmail: vi.fn().mockResolvedValue(undefined),
}));

// Complements leave.service.test.ts: those tests call the service directly, so
// they cannot catch a route that forgot requireRole('HR'). These go through the
// full middleware chain.
const API = '/api/v1/leave';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('leave routes — authentication', () => {
  it.each([
    ['get', '/'],
    ['get', '/balances'],
    ['post', '/'],
  ] as const)('rejects an unauthenticated %s %s with 401', async (method, path) => {
    const res = await request(app)[method](`${API}${path}`);
    expect(res.status).toBe(401);
  });
});

describe('leave routes — HR-only endpoints', () => {
  it('forbids an employee from listing every balance (403)', async () => {
    const { user } = await createEmployeeWithUser();
    const res = await request(app)
      .get(`${API}/balances`)
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(403);
  });

  it('allows HR to list every balance', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const res = await request(app)
      .get(`${API}/balances`)
      .set('Authorization', `Bearer ${signToken(hr)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('no longer exposes the review route (404)', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    const leave = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    const res = await request(app)
      .patch(`${API}/${leave.id}/review`)
      .set('Authorization', `Bearer ${signToken(hr)}`)
      .send({ action: 'APPROVE' });

    expect(res.status).toBe(404);
  });

  it('lets HR cancel past-dated leave, refunding the paid days', async () => {
    // HR's override: the date window that stops an employee withdrawing leave they
    // have already taken does not apply to HR.
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    const accrual = await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 2,
      daysConsumed: 2,
    });
    const leave = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2020-07-06',
      endDate: '2020-07-07',
      totalDays: 2,
    });

    const res = await request(app)
      .delete(`${API}/${leave.id}`)
      .set('Authorization', `Bearer ${signToken(hr)}`);

    expect(res.status).toBe(200);
    await expect(prisma.leaveRequest.findUnique({ where: { id: leave.id } })).resolves.toBeNull();
    const after = await prisma.leaveAccrual.findUniqueOrThrow({ where: { id: accrual.id } });
    expect(Number(after.daysConsumed)).toBe(0);
  });
});

describe('leave routes — record scoping', () => {
  it("does not leak another employee's requests through the employeeId filter", async () => {
    const { employee, user } = await createEmployeeWithUser();
    const other = await createEmployee();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });
    await createLeaveRequest({
      employeeId: other.id,
      startDate: '2026-07-13',
      endDate: '2026-07-14',
      totalDays: 2,
    });

    const res = await request(app)
      .get(`${API}?employeeId=${other.id}`)
      .set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].employeeId).toBe(employee.id);
  });

  it("refuses to delete another employee's request (403)", async () => {
    const { user } = await createEmployeeWithUser();
    const other = await createEmployee();
    const leave = await createLeaveRequest({
      employeeId: other.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    const res = await request(app)
      .delete(`${API}/${leave.id}`)
      .set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.status).toBe(403);
    await expect(
      prisma.leaveRequest.findUnique({ where: { id: leave.id } }),
    ).resolves.not.toBeNull();
  });

  it('requires HR to name an employee when reading a balance (400)', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const res = await request(app)
      .get(`${API}/balance`)
      .set('Authorization', `Bearer ${signToken(hr)}`);
    expect(res.status).toBe(400);
  });
});

describe('leave routes — paid balance', () => {
  it('consumes the balance the moment leave is submitted', async () => {
    const { employee, user } = await createEmployeeWithUser();
    const token = signToken(user);

    const before = await request(app)
      .get(`${API}/balance`)
      .set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    // Far enough out that the range is unaffected by weekends near "now".
    const created = await request(app)
      .post(API)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'PAID', startDate: '2027-03-01', endDate: '2027-03-02' });
    expect(created.status).toBe(201);
    expect(created.body.totalDays).toBe(2);

    const after = await request(app)
      .get(`${API}/balance`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.balance).toBe(before.body.balance - 2);
    expect(after.body.usedTotal).toBe(before.body.usedTotal + 2);

    const consumed = await prisma.leaveAccrual.aggregate({
      where: { employeeId: employee.id },
      _sum: { daysConsumed: true },
    });
    expect(Number(consumed._sum.daysConsumed)).toBe(2);
  });
});

describe('leave routes — request validation', () => {
  it('rejects an end date before the start date (400)', async () => {
    const { user } = await createEmployeeWithUser();
    const res = await request(app)
      .post(API)
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send({ type: 'SICK', startDate: '2026-07-10', endDate: '2026-07-06' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects an unknown leave type (400)', async () => {
    const { user } = await createEmployeeWithUser();
    const res = await request(app)
      .post(API)
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send({ type: 'UNPAID', startDate: '2026-07-06', endDate: '2026-07-07' });
    expect(res.status).toBe(400);
  });
});
