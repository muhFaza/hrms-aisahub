import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createPeriodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const patchRateSchema = z.object({
  exchangeRate: z.coerce.number().positive(),
});

export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;
export type PatchRateInput = z.infer<typeof patchRateSchema>;
