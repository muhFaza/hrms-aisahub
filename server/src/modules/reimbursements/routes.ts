import { Router } from 'express';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { upload } from '../../middleware/upload';
import { asyncHandler } from '../../lib/asyncHandler';
import {
  createReimbursementSchema,
  idParamSchema,
  listReimbursementsQuerySchema,
  reviewReimbursementSchema,
} from './schemas';
import * as controller from './controller';

// Mounted behind authenticate in index.ts. Any employee submits with evidence; HR reviews.
export const reimbursementsRoutes = Router();

reimbursementsRoutes.get(
  '/',
  validate({ query: listReimbursementsQuerySchema }),
  asyncHandler(controller.list),
);
// upload.single runs first so multer populates req.body text fields before validation.
reimbursementsRoutes.post(
  '/',
  upload.single('evidence'),
  validate({ body: createReimbursementSchema }),
  asyncHandler(controller.create),
);
reimbursementsRoutes.get(
  '/:id/evidence',
  validate({ params: idParamSchema }),
  asyncHandler(controller.downloadEvidence),
);
reimbursementsRoutes.patch(
  '/:id/review',
  requireRole('HR'),
  validate({ params: idParamSchema, body: reviewReimbursementSchema }),
  asyncHandler(controller.review),
);
reimbursementsRoutes.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove),
);
