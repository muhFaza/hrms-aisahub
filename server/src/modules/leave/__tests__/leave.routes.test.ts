import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../app';
import { prisma } from '../../../config/prisma';
import {
  createEmployee,
  createEmployeeWithUser,
  createLeaveRequest,
  createUser,
  resetDb,
  signToken,
} from '../../../__tests__/helpers/factories';

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

  it('forbids an employee from reviewing a request (403)', async () => {
    const { employee, user } = await createEmployeeWithUser();
    const leave = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    const res = await request(app)
      .patch(`${API}/${leave.id}/review`)
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send({ action: 'APPROVE' });

    expect(res.status).toBe(403);
    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
    expect(after.status).toBe('PENDING');
  });

  it('lets HR review a request', async () => {
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

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
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

  it('requires a reason when rejecting (400)', async () => {
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
      .send({ action: 'REJECT' });

    expect(res.status).toBe(400);
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
