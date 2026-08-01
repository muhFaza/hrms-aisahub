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

  // Self-service password change. Every rejection asserts the stored password still works
  // rather than trusting the status code: a 200 would not prove the hash actually moved, and
  // a 4xx would not prove it did not.
  describe('POST /auth/password', () => {
    const NEW_PASSWORD = 'new-password-123';

    it('changes the password: the new one logs in and the old one stops working', async () => {
      await createUser({ roleName: 'EMPLOYEE', email: 'self@example.test' });
      const token = await login('self@example.test', TEST_PASSWORD);

      const res = await request(app)
        .post(`${API}/auth/password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(200);

      const withNew = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'self@example.test', password: NEW_PASSWORD });
      expect(withNew.status).toBe(200);

      const withOld = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'self@example.test', password: TEST_PASSWORD });
      expect(withOld.status).toBe(401);
    });

    // 400 rather than 401 is load-bearing: the client treats a 401 outside /auth/login as an
    // expired session and redirects, so a typo here would sign the user out.
    it('rejects a wrong current password with 400 and leaves the password alone', async () => {
      await createUser({ roleName: 'EMPLOYEE', email: 'typo@example.test' });
      const token = await login('typo@example.test', TEST_PASSWORD);

      const res = await request(app)
        .post(`${API}/auth/password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'not-my-password', newPassword: NEW_PASSWORD });

      expect(res.status).toBe(400);

      const stillWorks = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'typo@example.test', password: TEST_PASSWORD });
      expect(stillWorks.status).toBe(200);
    });

    it('rejects a new password identical to the current one (400)', async () => {
      await createUser({ roleName: 'EMPLOYEE', email: 'same@example.test' });
      const token = await login('same@example.test', TEST_PASSWORD);

      const res = await request(app)
        .post(`${API}/auth/password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });

      expect(res.status).toBe(400);

      const stillWorks = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'same@example.test', password: TEST_PASSWORD });
      expect(stillWorks.status).toBe(200);
    });

    it('rejects a new password under 6 characters (400) and leaves the password alone', async () => {
      await createUser({ roleName: 'EMPLOYEE', email: 'short@example.test' });
      const token = await login('short@example.test', TEST_PASSWORD);

      const res = await request(app)
        .post(`${API}/auth/password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'abc' });

      expect(res.status).toBe(400);

      const stillWorks = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'short@example.test', password: TEST_PASSWORD });
      expect(stillWorks.status).toBe(200);
    });

    it('rejects an unauthenticated change (401)', async () => {
      const res = await request(app)
        .post(`${API}/auth/password`)
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(401);
    });

    // The route carries no id — it acts on req.user.userId — so there is no parameter to
    // point at somebody else. This pins that property rather than the absence of the param.
    it('changes only the caller, never another account', async () => {
      await createUser({ roleName: 'EMPLOYEE', email: 'actor@example.test' });
      await createUser({ roleName: 'EMPLOYEE', email: 'bystander@example.test' });
      const token = await login('actor@example.test', TEST_PASSWORD);

      const res = await request(app)
        .post(`${API}/auth/password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(200);

      const bystander = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'bystander@example.test', password: TEST_PASSWORD });
      expect(bystander.status).toBe(200);
    });
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
