import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// min(6) on the new password matches createUserSchema and the HR reset path, so the rule a
// password must satisfy does not depend on who set it. The current password is min(1): it is
// checked against the stored hash, and rejecting it on length would leak that the account
// predates the rule.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
