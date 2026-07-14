import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { HttpError } from '../../lib/httpError';
import type { LoginInput } from './schemas';

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

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!user) {
    throw new HttpError(401, 'User no longer exists');
  }
  return serializeUser(user);
}
