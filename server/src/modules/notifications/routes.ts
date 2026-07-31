import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { idParamSchema, listNotificationsQuerySchema } from './schemas';
import * as controller from './controller';

// Mounted behind authenticate in app.ts. Both roles read their own notifications;
// there is no create endpoint — notifications originate only from domain events.
export const notificationsRoutes = Router();

notificationsRoutes.get(
  '/',
  validate({ query: listNotificationsQuerySchema }),
  asyncHandler(controller.list),
);
// Static paths first, or /:id/read would swallow them.
notificationsRoutes.get('/unread-count', asyncHandler(controller.unreadCount));
notificationsRoutes.post('/read-all', asyncHandler(controller.readAll));
notificationsRoutes.patch(
  '/:id/read',
  validate({ params: idParamSchema }),
  asyncHandler(controller.read),
);
