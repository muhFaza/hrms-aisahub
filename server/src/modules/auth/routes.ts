import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { changePasswordSchema, loginSchema } from './schemas';
import * as controller from './controller';

export const authRoutes = Router();

// This router is mounted WITHOUT authenticate (it is the only one), so every route past
// /login attaches the middleware itself.
authRoutes.post('/login', validate({ body: loginSchema }), asyncHandler(controller.login));
authRoutes.get('/me', authenticate, asyncHandler(controller.me));
authRoutes.post(
  '/password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(controller.changePassword),
);
