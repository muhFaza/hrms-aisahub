import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import {
  createDailyLogSchema,
  idParamSchema,
  listDailyLogsQuerySchema,
  updateDailyLogSchema,
} from './schemas';
import * as controller from './controller';

// Mounted behind authenticate in index.ts. Part-timers manage their own logs; HR views/edits all.
export const dailyLogsRoutes = Router();

dailyLogsRoutes.get(
  '/',
  validate({ query: listDailyLogsQuerySchema }),
  asyncHandler(controller.list),
);
dailyLogsRoutes.post('/', validate({ body: createDailyLogSchema }), asyncHandler(controller.create));
dailyLogsRoutes.put(
  '/:id',
  validate({ params: idParamSchema, body: updateDailyLogSchema }),
  asyncHandler(controller.update),
);
dailyLogsRoutes.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove),
);
