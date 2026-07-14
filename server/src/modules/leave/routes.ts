import { Router } from 'express';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import {
  balanceQuerySchema,
  calendarQuerySchema,
  createLeaveSchema,
  idParamSchema,
  listLeaveQuerySchema,
  reviewLeaveSchema,
} from './schemas';
import * as controller from './controller';

// Mounted behind authenticate in index.ts. Services scope employees to their own data.
export const leaveRoutes = Router();

// Static routes registered before the parameterized ones.
leaveRoutes.get(
  '/balance',
  validate({ query: balanceQuerySchema }),
  asyncHandler(controller.balance),
);
leaveRoutes.get('/balances', requireRole('HR'), asyncHandler(controller.balances));
leaveRoutes.get(
  '/calendar',
  validate({ query: calendarQuerySchema }),
  asyncHandler(controller.calendar),
);

leaveRoutes.get('/', validate({ query: listLeaveQuerySchema }), asyncHandler(controller.list));
leaveRoutes.post('/', validate({ body: createLeaveSchema }), asyncHandler(controller.create));
leaveRoutes.patch(
  '/:id/review',
  requireRole('HR'),
  validate({ params: idParamSchema, body: reviewLeaveSchema }),
  asyncHandler(controller.review),
);
leaveRoutes.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove),
);
