import { Router } from 'express';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import {
  createOvertimeSchema,
  idParamSchema,
  listOvertimeQuerySchema,
  reviewOvertimeSchema,
} from './schemas';
import * as controller from './controller';

// Mounted behind authenticate in index.ts. Full-timers submit; HR reviews.
export const overtimeRoutes = Router();

overtimeRoutes.get(
  '/',
  validate({ query: listOvertimeQuerySchema }),
  asyncHandler(controller.list),
);
overtimeRoutes.post('/', validate({ body: createOvertimeSchema }), asyncHandler(controller.create));
overtimeRoutes.patch(
  '/:id/review',
  requireRole('HR'),
  validate({ params: idParamSchema, body: reviewOvertimeSchema }),
  asyncHandler(controller.review),
);
overtimeRoutes.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove),
);
