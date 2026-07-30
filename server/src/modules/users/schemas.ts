import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  roleId: z.coerce.number().int().positive(),
  employeeId: z.coerce.number().int().positive().nullish(),
});

// roleId is deliberately absent: a user's role is fixed when the account is created.
// Accepting it here would also reopen a staleness window, since an already-issued
// token would keep the old role until it expired.
export const updateUserSchema = z
  .object({
    isActive: z.boolean().optional(),
    password: z.string().min(6).optional(),
    employeeId: z.coerce.number().int().positive().nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
