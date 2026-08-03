import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
  .transform((value, ctx) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'date must be a valid calendar date',
      });
      return z.NEVER;
    }
    return date;
  });

function validateDatePair(
  data: { startDate?: Date; endDate?: Date },
  ctx: z.RefinementCtx,
): void {
  if ((data.startDate === undefined) !== (data.endDate === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: data.startDate === undefined ? ['startDate'] : ['endDate'],
      message: 'startDate and endDate must be supplied together',
    });
  }
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'endDate must be on or after startDate',
    });
  }
}

export const createPeriodSchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .superRefine(validateDatePair);

export const patchPeriodSchema = z
  .object({
    exchangeRate: z.coerce.number().positive().optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.exchangeRate === undefined &&
      data.startDate === undefined &&
      data.endDate === undefined
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one change is required' });
    }
    validateDatePair(data, ctx);
  });

export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;
export type PatchPeriodInput = z.infer<typeof patchPeriodSchema>;
