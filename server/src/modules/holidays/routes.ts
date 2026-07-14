import { Router } from 'express';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { holidaySchema, idParamSchema, listHolidaysQuerySchema } from './schemas';
import * as controller from './controller';

// Mounted behind authenticate in index.ts. Any user reads; HR manages.
export const holidaysRoutes = Router();

holidaysRoutes.get(
  '/',
  validate({ query: listHolidaysQuerySchema }),
  asyncHandler(controller.list),
);
holidaysRoutes.post(
  '/',
  requireRole('HR'),
  validate({ body: holidaySchema }),
  asyncHandler(controller.create),
);
holidaysRoutes.put(
  '/:id',
  requireRole('HR'),
  validate({ params: idParamSchema, body: holidaySchema }),
  asyncHandler(controller.update),
);
holidaysRoutes.delete(
  '/:id',
  requireRole('HR'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove),
);
