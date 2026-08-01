import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { HttpError } from '../../lib/httpError';
import type { ChangePasswordInput, LoginInput } from './schemas';

// Relations loaded to build the client-facing user shape (login + /me).
const userInclude = Prisma.validator<Prisma.UserInclude>()({
  role: true,
  employee: {
    select: { id: true, fullName: true, nickname: true, employmentType: true },
  },
});

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function serializeUser(user: UserWithRelations) {
  return {
    id: user.id,
    email: user.email,
    roleName: user.role.name,
    employee: user.employee
      ? {
          id: user.employee.id,
          fullName: user.employee.fullName,
          nickname: user.employee.nickname,
          employmentType: user.employee.employmentType,
        }
      : null,
  };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: userInclude,
  });

  // Generic message on missing user / wrong password to avoid leaking existence.
  if (!user) {
    throw new HttpError(401, 'Invalid email or password');
  }
  const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordOk) {
    throw new HttpError(401, 'Invalid email or password');
  }
  if (!user.isActive) {
    throw new HttpError(401, 'Account is deactivated');
  }

  const token = jwt.sign(
    { userId: user.id, roleName: user.role.name, employeeId: user.employeeId ?? null },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn } as jwt.SignOptions,
  );

  return { token, user: serializeUser(user) };
}

// Self-service password change. Lives here rather than in the users module because every
// /users route is HR-only router-wide, and this is the one password path an employee owns.
//
// Note it does NOT invalidate other sessions: there is no revocation list, so tokens already
// issued stay valid until they expire. Deactivating the account is still the only immediate
// revocation. The UI says so at the point of change.
export async function changePassword(userId: number, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) {
    throw new HttpError(401, 'User no longer exists');
  }

  // 400, deliberately not 401: the client's axios interceptor treats any 401 outside
  // /auth/login as an expired session and bounces to the login page, so a mistyped current
  // password would log the user out instead of showing them the error.
  const currentOk = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!currentOk) {
    throw new HttpError(400, 'Current password is incorrect');
  }

  const unchanged = await bcrypt.compare(input.newPassword, user.passwordHash);
  if (unchanged) {
    throw new HttpError(400, 'New password must be different from the current password');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!user) {
    throw new HttpError(401, 'User no longer exists');
  }
  return serializeUser(user);
}
