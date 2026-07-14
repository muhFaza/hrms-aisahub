import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as controller from './controller';

// Mounted behind authenticate in app.ts. The response shape is scoped by role.
export const dashboardRoutes = Router();

dashboardRoutes.get('/', asyncHandler(controller.get));
