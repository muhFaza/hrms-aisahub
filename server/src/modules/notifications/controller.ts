import type { Request, Response } from 'express';
import * as notificationsService from './service';
import type { ListNotificationsQuery } from './schemas';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await notificationsService.listNotifications(
    req.user!.userId,
    req.query as unknown as ListNotificationsQuery,
  );
  res.json(result);
}

export async function unreadCount(req: Request, res: Response): Promise<void> {
  res.json(await notificationsService.getUnreadCount(req.user!.userId));
}

export async function readAll(req: Request, res: Response): Promise<void> {
  res.json(await notificationsService.markAllRead(req.user!.userId));
}

export async function read(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.json(await notificationsService.markRead(req.user!.userId, id));
}
