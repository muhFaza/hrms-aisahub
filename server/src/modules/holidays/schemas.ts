import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listHolidaysQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
});

export const holidaySchema = z.object({
  name: z.string().trim().min(1),
  date: z.coerce.date(),
  type: z.enum(['NATIONAL', 'COMPANY', 'JOINT_LEAVE', 'SPECIAL']).default('NATIONAL'),
  notes: z.string().trim().nullish(),
});

export type ListHolidaysQuery = z.infer<typeof listHolidaysQuerySchema>;
export type HolidayInput = z.infer<typeof holidaySchema>;
