import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { NotificationType } from '@prisma/client';
import { app } from '../../../app';
import { prisma } from '../../../config/prisma';
import {
  createEmployeeWithUser,
  createUser,
  resetDb,
  signToken,
} from '../../../__tests__/helpers/factories';

const API = '/api/v1/notifications';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

interface NotificationOptions {
  recipientId: number;
  type?: NotificationType;
  entityId?: number;
  readAt?: Date | null;
}

async function createNotification(options: NotificationOptions) {
  return prisma.notification.create({
    data: {
      recipientId: options.recipientId,
      type: options.type ?? 'LEAVE_DECIDED',
      entityType: 'LEAVE_REQUEST',
      entityId: options.entityId ?? 1,
      payload: { status: 'APPROVED' },
      readAt: options.readAt ?? null,
    },
  });
}

describe('notifications routes — authentication', () => {
  it.each([
    ['get', '/'],
    ['get', '/unread-count'],
    ['post', '/read-all'],
    ['patch', '/1/read'],
  ] as const)('rejects an unauthenticated %s %s with 401', async (method, path) => {
    const res = await request(app)[method](`${API}${path}`);
    expect(res.status).toBe(401);
  });

  it('is open to both roles', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser();

    for (const account of [hr, user]) {
      const res = await request(app)
        .get(`${API}/unread-count`)
        .set('Authorization', `Bearer ${signToken(account)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 0 });
    }
  });
});

describe('GET /notifications', () => {
  it("returns only the caller's own notifications", async () => {
    const { user } = await createEmployeeWithUser();
    const other = await createUser({ roleName: 'HR' });
    const mine = await createNotification({ recipientId: user.id });
    await createNotification({ recipientId: other.id });

    const res = await request(app).get(API).set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe(mine.id);
  });

  it('filters to unread when asked', async () => {
    const { user } = await createEmployeeWithUser();
    await createNotification({ recipientId: user.id, readAt: new Date() });
    const unread = await createNotification({ recipientId: user.id, entityId: 2 });

    const res = await request(app)
      .get(`${API}?unreadOnly=true`)
      .set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe(unread.id);
  });

  it('treats unreadOnly=false as no filter', async () => {
    const { user } = await createEmployeeWithUser();
    await createNotification({ recipientId: user.id, readAt: new Date() });
    await createNotification({ recipientId: user.id, entityId: 2 });

    const res = await request(app)
      .get(`${API}?unreadOnly=false`)
      .set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.body.total).toBe(2);
  });

  it('paginates while reporting the unpaginated total', async () => {
    const { user } = await createEmployeeWithUser();
    for (const entityId of [1, 2, 3]) {
      await createNotification({ recipientId: user.id, entityId });
    }

    const res = await request(app)
      .get(`${API}?page=2&pageSize=2`)
      .set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.body.total).toBe(3);
    expect(res.body.data).toHaveLength(1);
  });

  it('rejects a pageSize above the 100 cap (400)', async () => {
    const { user } = await createEmployeeWithUser();
    const res = await request(app)
      .get(`${API}?pageSize=500`)
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(400);
  });

  it('flattens the resolver name for display', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { employee, user } = await createEmployeeWithUser({ fullName: 'Rina Hartono' });
    const notification = await createNotification({ recipientId: hr.id });
    await prisma.notification.update({
      where: { id: notification.id },
      data: { resolvedAt: new Date(), resolvedById: user.id },
    });

    const res = await request(app).get(API).set('Authorization', `Bearer ${signToken(hr)}`);

    expect(res.body.data[0].resolvedByName).toBe(employee.fullName);
  });
});

describe('GET /notifications/unread-count', () => {
  it("counts only the caller's unread rows", async () => {
    const { user } = await createEmployeeWithUser();
    const other = await createUser({ roleName: 'HR' });
    await createNotification({ recipientId: user.id });
    await createNotification({ recipientId: user.id, entityId: 2, readAt: new Date() });
    await createNotification({ recipientId: other.id, entityId: 3 });

    const res = await request(app)
      .get(`${API}/unread-count`)
      .set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.body).toEqual({ count: 1 });
  });
});

describe('PATCH /notifications/:id/read', () => {
  it('marks the caller’s own notification read', async () => {
    const { user } = await createEmployeeWithUser();
    const notification = await createNotification({ recipientId: user.id });

    const res = await request(app)
      .patch(`${API}/${notification.id}/read`)
      .set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.status).toBe(200);
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(stored.readAt).not.toBeNull();
  });

  it("refuses to mark another user's notification and leaves it unread (404)", async () => {
    const { user } = await createEmployeeWithUser();
    const other = await createUser({ roleName: 'HR' });
    const theirs = await createNotification({ recipientId: other.id });

    const res = await request(app)
      .patch(`${API}/${theirs.id}/read`)
      .set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.status).toBe(404);
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(stored.readAt).toBeNull();
  });

  it('404s for an unknown id', async () => {
    const { user } = await createEmployeeWithUser();
    const res = await request(app)
      .patch(`${API}/999999/read`)
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric id (400)', async () => {
    const { user } = await createEmployeeWithUser();
    const res = await request(app)
      .patch(`${API}/abc/read`)
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /notifications/read-all', () => {
  it("marks every unread row of the caller's and nobody else's", async () => {
    const { user } = await createEmployeeWithUser();
    const other = await createUser({ roleName: 'HR' });
    await createNotification({ recipientId: user.id });
    await createNotification({ recipientId: user.id, entityId: 2 });
    const theirs = await createNotification({ recipientId: other.id, entityId: 3 });

    const res = await request(app)
      .post(`${API}/read-all`)
      .set('Authorization', `Bearer ${signToken(user)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    await expect(
      prisma.notification.count({ where: { recipientId: user.id, readAt: null } }),
    ).resolves.toBe(0);
    const untouched = await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(untouched.readAt).toBeNull();
  });
});
