import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { ListNotificationsQuery } from './schemas';

const notificationInclude = Prisma.validator<Prisma.NotificationInclude>()({
  resolvedBy: { select: { email: true, employee: { select: { fullName: true } } } },
});

type NotificationRow = Prisma.NotificationGetPayload<{ include: typeof notificationInclude }>;

function serializeNotification(notification: NotificationRow) {
  return {
    id: notification.id,
    type: notification.type,
    entityType: notification.entityType,
    entityId: notification.entityId,
    payload: notification.payload,
    readAt: notification.readAt,
    resolvedAt: notification.resolvedAt,
    // Flattened for display ("Handled by …"); HR accounts need not have an employee profile.
    resolvedByName:
      notification.resolvedBy?.employee?.fullName ?? notification.resolvedBy?.email ?? null,
    createdAt: notification.createdAt,
  };
}

// Every query is scoped to the caller's own userId — there is no path to another
// user's notifications.
export async function listNotifications(userId: number, query: ListNotificationsQuery) {
  const where: Prisma.NotificationWhereInput = { recipientId: userId };
  if (query.unreadOnly) where.readAt = null;

  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: notificationInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    data: rows.map(serializeNotification),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getUnreadCount(userId: number): Promise<{ count: number }> {
  const count = await prisma.notification.count({
    where: { recipientId: userId, readAt: null },
  });
  return { count };
}

export async function markRead(userId: number, id: number) {
  // Scoped update: another user's notification is a 404, not a 403, so the endpoint
  // never confirms that the id exists.
  const result = await prisma.notification.updateMany({
    where: { id, recipientId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    const existing = await prisma.notification.findFirst({
      where: { id, recipientId: userId },
      include: notificationInclude,
    });
    if (!existing) {
      throw new HttpError(404, 'Notification not found');
    }
    return serializeNotification(existing);
  }

  const updated = await prisma.notification.findFirstOrThrow({
    where: { id, recipientId: userId },
    include: notificationInclude,
  });
  return serializeNotification(updated);
}

export async function markAllRead(userId: number): Promise<{ updated: number }> {
  const result = await prisma.notification.updateMany({
    where: { recipientId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}
