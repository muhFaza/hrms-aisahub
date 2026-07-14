import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { loginSchema } from './schemas';
import * as controller from './controller';

export const authRoutes = Router();

authRoutes.post('/login', validate({ body: loginSchema }), asyncHandler(controller.login));
authRoutes.get('/me', authenticate, asyncHandler(controller.me));
