import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listDailyLogsQuerySchema = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'month must be in YYYY-MM format')
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

// Hours 0.5–24 in half-hour steps; project required, notes optional (design §4).
const dailyLogFields = z.object({
  date: z.coerce.date(),
  hours: z.coerce.number().min(0.5).max(24).multipleOf(0.5, 'hours must be in 0.5 increments'),
  project: z.string().trim().min(1),
  notes: z.string().trim().max(500).nullish(),
});

export const createDailyLogSchema = dailyLogFields;
export const updateDailyLogSchema = dailyLogFields;

export type ListDailyLogsQuery = z.infer<typeof listDailyLogsQuerySchema>;
export type DailyLogInput = z.infer<typeof createDailyLogSchema>;
