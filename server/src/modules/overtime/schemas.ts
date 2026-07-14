import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listOvertimeQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

// Hours 0.5–12 in half-hour steps; description required (design §4).
export const createOvertimeSchema = z.object({
  date: z.coerce.date(),
  hours: z.coerce.number().min(0.5).max(12).multipleOf(0.5, 'hours must be in 0.5 increments'),
  description: z.string().trim().min(1).max(500),
});

export const reviewOvertimeSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT']),
    rejectReason: z.string().trim().max(500).nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'REJECT' && !data.rejectReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectReason'],
        message: 'rejectReason is required when rejecting',
      });
    }
  });

export type ListOvertimeQuery = z.infer<typeof listOvertimeQuerySchema>;
export type CreateOvertimeInput = z.infer<typeof createOvertimeSchema>;
export type ReviewOvertimeInput = z.infer<typeof reviewOvertimeSchema>;
