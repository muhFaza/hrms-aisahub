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

export const updateUserSchema = z
  .object({
    roleId: z.coerce.number().int().positive().optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(6).optional(),
    employeeId: z.coerce.number().int().positive().nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
