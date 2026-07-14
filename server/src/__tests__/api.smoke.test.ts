import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../config/prisma';

// Integration smoke tests against the seeded database (login + RBAC UAT scenarios).
const API = '/api/v1';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password });
  return res.body.token as string;
}

describe('API smoke', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('GET /health returns 200', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('logs in an HR account and returns a token', async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'hr@aisahub.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.roleName).toBe('HR');
  });

  it('rejects a bad password with 401', async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'hr@aisahub.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('rejects GET /employees without a token (401)', async () => {
    const res = await request(app).get(`${API}/employees`);
    expect(res.status).toBe(401);
  });

  it('forbids an employee from listing employees (403)', async () => {
    const token = await login('budi@aisahub.com', 'password123');
    const res = await request(app).get(`${API}/employees`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('forbids an employee from listing payroll periods (403)', async () => {
    const token = await login('budi@aisahub.com', 'password123');
    const res = await request(app)
      .get(`${API}/payroll/periods`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
