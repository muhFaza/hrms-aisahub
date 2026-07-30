import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authenticate } from '../auth';
import { errorHandler } from '../errorHandler';
import { prisma } from '../../config/prisma';
import { createEmployee, createUser, resetDb, signToken } from '../../__tests__/helpers/factories';

// A minimal app that exposes whatever authenticate() attached, so the assertions
// are about the middleware rather than any particular feature route.
const probe = express();
probe.get('/probe', authenticate, (req, res) => {
  res.json(req.user ?? null);
});
probe.use(errorHandler);

function get(token?: string) {
  const req = request(probe).get('/probe');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

describe('authenticate', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('token presence and shape', () => {
    it('rejects a request with no Authorization header (401)', async () => {
      const res = await request(probe).get('/probe');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Missing or invalid Authorization header/);
    });

    it('rejects a non-Bearer Authorization scheme (401)', async () => {
      const res = await request(probe).get('/probe').set('Authorization', 'Basic abc123');
      expect(res.status).toBe(401);
    });

    it('rejects a Bearer header with an empty token (401)', async () => {
      const res = await request(probe).get('/probe').set('Authorization', 'Bearer ');
      expect(res.status).toBe(401);
    });

    it('rejects a structurally invalid token (401)', async () => {
      const res = await get('not-a-jwt');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or expired token/);
    });
  });

  describe('signature and expiry', () => {
    it('rejects a token signed with a different secret (401)', async () => {
      // The forged payload is well-formed; only the signature is wrong.
      const forged = jwt.sign({ userId: 1, roleName: 'HR', employeeId: null }, 'not-the-secret');
      const res = await get(forged);
      expect(res.status).toBe(401);
    });

    it('rejects an expired token (401)', async () => {
      const user = await createUser({ roleName: 'HR' });
      const expired = signToken(user, { expiresIn: '-1s' });
      const res = await get(expired);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or expired token/);
    });

    it('accepts an unexpired token signed with the configured secret', async () => {
      const user = await createUser({ roleName: 'HR' });
      const res = await get(signToken(user));
      expect(res.status).toBe(200);
    });
  });

  describe('account state is re-checked on every request', () => {
    it('rejects a valid token whose user has been deactivated (401)', async () => {
      // The token stays cryptographically valid for its full 12h lifetime, so
      // deactivation only takes effect because of the per-request DB lookup.
      const user = await createUser({ roleName: 'EMPLOYEE' });
      const token = signToken(user);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      const res = await get(token);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/inactive or no longer exists/);
    });

    it('rejects a valid token whose user has been deleted (401)', async () => {
      const user = await createUser({ roleName: 'EMPLOYEE' });
      const token = signToken(user);
      await prisma.user.delete({ where: { id: user.id } });

      const res = await get(token);
      expect(res.status).toBe(401);
    });
  });

  describe('req.user payload', () => {
    it('attaches userId, roleName and employeeId', async () => {
      const employee = await createEmployee();
      const user = await createUser({ roleName: 'EMPLOYEE', employeeId: employee.id });

      const res = await get(signToken(user));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: user.id,
        roleName: 'EMPLOYEE',
        employeeId: employee.id,
      });
    });

    it('normalizes a missing employeeId claim to null', async () => {
      // HR accounts have no employee profile; downstream code branches on `null`,
      // so `undefined` must never reach it.
      const user = await createUser({ roleName: 'HR' });

      const res = await get(signToken(user));
      expect(res.status).toBe(200);
      expect(res.body.employeeId).toBeNull();
    });

    it('takes roleName from the token, not from the database', async () => {
      // Documents a real staleness window: a role change does NOT invalidate
      // tokens already issued, so a demoted user keeps HR access until expiry
      // (default 12h). Only isActive is re-checked per request.
      const user = await createUser({ roleName: 'HR' });
      const token = signToken(user);

      const employeeRole = await prisma.role.upsert({
        where: { name: 'EMPLOYEE' },
        update: {},
        create: { name: 'EMPLOYEE' },
      });
      await prisma.user.update({ where: { id: user.id }, data: { roleId: employeeRole.id } });

      const res = await get(token);
      expect(res.status).toBe(200);
      expect(res.body.roleName).toBe('HR');
    });
  });
});
