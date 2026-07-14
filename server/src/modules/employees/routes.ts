import { Router } from 'express';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { upload } from '../../middleware/upload';
import { asyncHandler } from '../../lib/asyncHandler';
import {
  createEmployeeSchema,
  idParamSchema,
  listEmployeesQuerySchema,
  updateEmployeeSchema,
} from './schemas';
import * as controller from './controller';

// Mounted behind authenticate in index.ts. HR manages; employees read their own.
export const employeesRoutes = Router();

employeesRoutes.get(
  '/',
  requireRole('HR'),
  validate({ query: listEmployeesQuerySchema }),
  asyncHandler(controller.list),
);
employeesRoutes.post(
  '/',
  requireRole('HR'),
  validate({ body: createEmployeeSchema }),
  asyncHandler(controller.create),
);
employeesRoutes.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(controller.getById),
);
employeesRoutes.put(
  '/:id',
  requireRole('HR'),
  validate({ params: idParamSchema, body: updateEmployeeSchema }),
  asyncHandler(controller.update),
);
employeesRoutes.post(
  '/:id/contract',
  requireRole('HR'),
  validate({ params: idParamSchema }),
  upload.single('file'),
  asyncHandler(controller.uploadContract),
);
employeesRoutes.get(
  '/:id/contract',
  validate({ params: idParamSchema }),
  asyncHandler(controller.downloadContract),
);
