import { Router } from 'express';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createUserSchema, idParamSchema, updateUserSchema } from './schemas';
import * as controller from './controller';

// Mounted behind authenticate in index.ts; HR-only for every route.
export const usersRoutes = Router();

usersRoutes.use(requireRole('HR'));

usersRoutes.get('/', asyncHandler(controller.list));
usersRoutes.get('/roles', asyncHandler(controller.roles));
usersRoutes.post('/', validate({ body: createUserSchema }), asyncHandler(controller.create));
usersRoutes.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateUserSchema }),
  asyncHandler(controller.update),
);
