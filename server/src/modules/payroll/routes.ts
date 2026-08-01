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

// Any employee may export a payslip; the service restricts it to their own unless they are HR.
payrollRoutes.get(
  '/payslips/:id/export/pdf',
  validate({ params: idParamSchema }),
  asyncHandler(controller.exportPayslipPdf),
);

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
// Registered before PATCH/DELETE on /periods/:id purely for readability — the paths differ by
// a suffix, so order is not load-bearing here.
payrollRoutes.get(
  '/periods/:id/export/pdf',
  requireRole('HR'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.exportPeriodPdf),
);
payrollRoutes.get(
  '/periods/:id/export/csv',
  requireRole('HR'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.exportPeriodCsv),
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
