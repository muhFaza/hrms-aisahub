import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../config/prisma';
import {
  TEST_PASSWORD,
  createEmployeeWithUser,
  createUser,
  resetDb,
} from './helpers/factories';

// Integration smoke tests (login + RBAC UAT scenarios). Accounts are created per
// test rather than taken from prisma/seed.ts, so the suite runs on a clean
// database and does not break when the seed data is reshuffled.
const API = '/api/v1';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password });
  return res.body.token as string;
}

describe('API smoke', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('GET /health returns 200', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('logs in an HR account and returns a token', async () => {
    await createUser({ roleName: 'HR', email: 'hr@example.test' });

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'hr@example.test', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.roleName).toBe('HR');
  });

  it('rejects a bad password with 401', async () => {
    await createUser({ roleName: 'HR', email: 'hr@example.test' });

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'hr@example.test', password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('rejects login for an unknown email with the same 401 as a bad password', async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@example.test', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects login for a deactivated account (401)', async () => {
    await createUser({ roleName: 'HR', email: 'gone@example.test', isActive: false });

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'gone@example.test', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('rejects GET /employees without a token (401)', async () => {
    const res = await request(app).get(`${API}/employees`);
    expect(res.status).toBe(401);
  });

  it('forbids an employee from listing employees (403)', async () => {
    await createEmployeeWithUser({ roleName: 'EMPLOYEE' });
    const { user } = await createEmployeeWithUser({ roleName: 'EMPLOYEE' });
    const token = await login(user.email, TEST_PASSWORD);

    const res = await request(app).get(`${API}/employees`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('forbids an employee from listing payroll periods (403)', async () => {
    const { user } = await createEmployeeWithUser({ roleName: 'EMPLOYEE' });
    const token = await login(user.email, TEST_PASSWORD);

    const res = await request(app)
      .get(`${API}/payroll/periods`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows HR to list employees', async () => {
    const hr = await createUser({ roleName: 'HR', email: 'hr@example.test' });
    await createEmployeeWithUser({ roleName: 'EMPLOYEE' });
    const token = await login(hr.email, TEST_PASSWORD);

    const res = await request(app).get(`${API}/employees`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns a JSON 404 for an unknown API path', async () => {
    const res = await request(app).get(`${API}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });
});
