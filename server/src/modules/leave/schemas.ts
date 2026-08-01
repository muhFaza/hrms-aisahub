import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listLeaveQuerySchema = z.object({
  type: z.enum(['PAID', 'SICK', 'UNPAID']).optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const createLeaveSchema = z
  .object({
    type: z.enum(['PAID', 'SICK', 'UNPAID']),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reason: z.string().trim().max(500).nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must be on or after startDate',
      });
    }
  });

export const balanceQuerySchema = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
});

export const calendarQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be in YYYY-MM format'),
});

export type ListLeaveQuery = z.infer<typeof listLeaveQuerySchema>;
export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
export type BalanceQuery = z.infer<typeof balanceQuerySchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
