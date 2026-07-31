import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// z.coerce.boolean() would read "false" as true, so match the string explicitly.
export const listNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
