import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listReimbursementsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

// Multipart text fields arrive as strings, hence z.coerce. amount is IDR > 0 (design §4).
export const createReimbursementSchema = z.object({
  date: z.coerce.date(),
  amount: z.coerce.number().positive(),
  description: z.string().trim().min(1).max(500),
});

export const reviewReimbursementSchema = z
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

export type ListReimbursementsQuery = z.infer<typeof listReimbursementsQuerySchema>;
export type CreateReimbursementInput = z.infer<typeof createReimbursementSchema>;
export type ReviewReimbursementInput = z.infer<typeof reviewReimbursementSchema>;
