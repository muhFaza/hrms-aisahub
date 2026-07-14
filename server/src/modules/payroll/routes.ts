import { Router } from 'express';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createPeriodSchema, idParamSchema, patchRateSchema } from './schemas';
import * as controller from './controller';

// Mounted behind authenticate in index.ts. Period admin is HR-only; any employee reads
// their own payslips via /my-payslips.
export const payrollRoutes = Router();

// Static route before the parameterized period routes.
payrollRoutes.get('/my-payslips', asyncHandler(controller.myPayslips));

payrollRoutes.get('/periods', requireRole('HR'), asyncHandler(controller.listPeriods));
payrollRoutes.post(
  '/periods',
  requireRole('HR'),
  validate({ body: createPeriodSchema }),
  asyncHandler(controller.createPeriod),
);
payrollRoutes.get(
  '/periods/:id',
  requireRole('HR'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.getPeriod),
);
payrollRoutes.patch(
  '/periods/:id',
  requireRole('HR'),
  validate({ params: idParamSchema, body: patchRateSchema }),
  asyncHandler(controller.patchRate),
);
payrollRoutes.post(
  '/periods/:id/finalize',
  requireRole('HR'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.finalize),
);
payrollRoutes.delete(
  '/periods/:id',
  requireRole('HR'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove),
);
