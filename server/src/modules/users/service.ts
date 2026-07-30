import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { CreateUserInput, UpdateUserInput } from './schemas';

const userInclude = Prisma.validator<Prisma.UserInclude>()({
  role: true,
  employee: { select: { fullName: true } },
});

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function serializeUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    roleId: user.roleId,
    roleName: user.role.name,
    employeeId: user.employeeId,
    employeeName: user.employee?.fullName ?? null,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export async function listUsers() {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' }, include: userInclude });
  return users.map(serializeUser);
}

// Role options for the create/edit user forms (design §6 Users page).
export async function listRoles() {
  return prisma.role.findMany({ orderBy: { id: 'asc' }, select: { id: true, name: true } });
}

export async function createUser(input: CreateUserInput) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      roleId: input.roleId,
      employeeId: input.employeeId ?? undefined,
    },
    include: userInclude,
  });
  return serializeUser(user);
}

export async function updateUser(id: number, actingUserId: number, input: UpdateUserInput) {
  // An HR user must not lock themselves out of the system.
  if (input.isActive === false && id === actingUserId) {
    throw new HttpError(400, 'You cannot deactivate your own account');
  }

  // roleId is intentionally not updatable — see updateUserSchema. To move someone
  // between HR and EMPLOYEE, deactivate the account and create a new one.
  const data: Prisma.UserUncheckedUpdateInput = {};
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.employeeId !== undefined) data.employeeId = input.employeeId;
  if (input.password !== undefined) data.passwordHash = await bcrypt.hash(input.password, 10);

  const user = await prisma.user.update({ where: { id }, data, include: userInclude });
  return serializeUser(user);
}
