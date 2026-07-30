import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../app';
import { prisma } from '../../../config/prisma';
import {
  createEmployeeWithUser,
  createRole,
  createUser,
  resetDb,
  signToken,
} from '../../../__tests__/helpers/factories';

const API = '/api/v1/users';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function hrToken(): Promise<string> {
  const hr = await createUser({ roleName: 'HR' });
  return signToken(hr);
}

describe('users routes — access', () => {
  it('rejects an unauthenticated request (401)', async () => {
    const res = await request(app).get(API);
    expect(res.status).toBe(401);
  });

  it('forbids a non-HR account from listing users (403)', async () => {
    const { user } = await createEmployeeWithUser();
    const res = await request(app).get(API).set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(403);
  });

  it('lets HR list users', async () => {
    const token = await hrToken();
    const res = await request(app).get(API).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('users routes — role is fixed at creation', () => {
  it('sets the role when the account is created', async () => {
    const token = await hrToken();
    const hrRole = await createRole('HR');

    const res = await request(app)
      .post(API)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new-hr@example.test', password: 'password123', roleId: hrRole.id });

    expect(res.status).toBe(201);
    expect(res.body.roleName).toBe('HR');
  });

  it('rejects an update that tries to change the role (400)', async () => {
    const token = await hrToken();
    const hrRole = await createRole('HR');
    const { user } = await createEmployeeWithUser({ roleName: 'EMPLOYEE' });

    const res = await request(app)
      .patch(`${API}/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleId: hrRole.id });

    expect(res.status).toBe(400);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { role: true },
    });
    expect(after.role.name).toBe('EMPLOYEE');
  });

  it('ignores a roleId smuggled alongside a legitimate field', async () => {
    // The schema strips unknown keys rather than erroring here, so the assertion
    // that matters is that the stored role is unchanged.
    const token = await hrToken();
    const hrRole = await createRole('HR');
    const { user } = await createEmployeeWithUser({ roleName: 'EMPLOYEE' });

    const res = await request(app)
      .patch(`${API}/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false, roleId: hrRole.id });

    expect(res.status).toBe(200);
    expect(res.body.roleName).toBe('EMPLOYEE');

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { role: true },
    });
    expect(after.role.name).toBe('EMPLOYEE');
    expect(after.isActive).toBe(false);
  });

  it('still allows the updates that are permitted', async () => {
    const token = await hrToken();
    const { user } = await createEmployeeWithUser({ roleName: 'EMPLOYEE' });

    const res = await request(app)
      .patch(`${API}/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it('refuses to let an HR user deactivate their own account (400)', async () => {
    const hr = await createUser({ roleName: 'HR' });

    const res = await request(app)
      .patch(`${API}/${hr.id}`)
      .set('Authorization', `Bearer ${signToken(hr)}`)
      .send({ isActive: false });

    expect(res.status).toBe(400);
  });
});

describe('a demotion takes effect immediately', () => {
  it('drops HR access on the next request when the role changes in the database', async () => {
    // Role edits are blocked at the API, so this simulates a direct database
    // change — the point is that the existing token stops granting HR access.
    const hr = await createUser({ roleName: 'HR' });
    const token = signToken(hr);

    const before = await request(app).get(API).set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    const employeeRole = await createRole('EMPLOYEE');
    await prisma.user.update({ where: { id: hr.id }, data: { roleId: employeeRole.id } });

    const after = await request(app).get(API).set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(403);
  });
});
