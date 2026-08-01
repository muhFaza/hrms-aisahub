import type { NotificationType, Prisma } from '@prisma/client';

// Emission lives in modules/, not lib/, because it reads the HR recipient list and
// writes rows — lib/ stays database-free.
//
// Every helper takes a transaction client so callers inside prisma.$transaction pass
// `tx`: a notification is an INSERT on a connection we already hold, so it belongs in
// the same transaction as the state change it describes. That is a deliberate
// departure from the fire-and-forget convention the emails followed.

// EMPLOYMENT is the odd one out: it groups a contract-end reminder, which describes a date
// approaching rather than a record somebody submitted.
export type EntityType =
  | 'LEAVE_REQUEST'
  | 'OVERTIME'
  | 'REIMBURSEMENT'
  | 'PAYSLIP'
  | 'EMPLOYMENT';

// Ties an HR fan-out together: acting on the request resolves every copy of it.
export function groupKeyFor(entityType: EntityType, entityId: number): string {
  return `${entityType}:${entityId}`;
}

interface EmitParams {
  type: NotificationType;
  entityType: EntityType;
  entityId: number;
  payload: Prisma.InputJsonValue;
}

// One row per active HR account, all sharing the group key. Returns how many were written.
export async function emitToHr(
  tx: Prisma.TransactionClient,
  params: EmitParams,
): Promise<number> {
  const hrUsers = await tx.user.findMany({
    where: { isActive: true, role: { name: 'HR' } },
    select: { id: true },
  });
  if (hrUsers.length === 0) return 0;

  const groupKey = groupKeyFor(params.entityType, params.entityId);
  const result = await tx.notification.createMany({
    data: hrUsers.map((user) => ({
      recipientId: user.id,
      type: params.type,
      entityType: params.entityType,
      entityId: params.entityId,
      payload: params.payload,
      groupKey,
    })),
  });
  return result.count;
}

// Delivers to the account linked to an employee profile. Employees without an account
// (profile-only records) simply receive nothing.
export async function emitToEmployee(
  tx: Prisma.TransactionClient,
  employeeId: number,
  params: EmitParams,
): Promise<boolean> {
  const user = await tx.user.findUnique({ where: { employeeId }, select: { id: true } });
  if (!user) return false;

  await tx.notification.create({
    data: {
      recipientId: user.id,
      type: params.type,
      entityType: params.entityType,
      entityId: params.entityId,
      payload: params.payload,
    },
  });
  return true;
}

export interface EmployeeTarget {
  employeeId: number;
  entityId: number;
  payload: Prisma.InputJsonValue;
}

// Batched sibling of emitToEmployee: one recipient lookup and one insert for the whole
// set. Payroll finalize notifies every employee at once, and a query per employee would
// hold its transaction open for a stretch that grows with headcount.
export async function emitToEmployees(
  tx: Prisma.TransactionClient,
  params: { type: NotificationType; entityType: EntityType; targets: EmployeeTarget[] },
): Promise<number> {
  if (params.targets.length === 0) return 0;

  const users = await tx.user.findMany({
    where: { employeeId: { in: params.targets.map((target) => target.employeeId) } },
    select: { id: true, employeeId: true },
  });
  const recipientByEmployee = new Map<number, number>();
  for (const user of users) {
    if (user.employeeId !== null) recipientByEmployee.set(user.employeeId, user.id);
  }

  const data = params.targets.flatMap((target) => {
    const recipientId = recipientByEmployee.get(target.employeeId);
    // Employees without an account (profile-only records) simply receive nothing.
    if (recipientId === undefined) return [];
    return [
      {
        recipientId,
        type: params.type,
        entityType: params.entityType,
        entityId: target.entityId,
        payload: target.payload,
      },
    ];
  });
  if (data.length === 0) return 0;

  const result = await tx.notification.createMany({ data });
  return result.count;
}

// Stamps every still-unresolved notification in the group as handled (and read, so the
// badge reflects work that is genuinely still pending). Returns the number resolved —
// callers use it to decide whether announcing the outcome to HR is worth anything.
export async function resolveGroup(
  tx: Prisma.TransactionClient,
  entityType: EntityType,
  entityId: number,
  resolvedById: number,
): Promise<number> {
  const groupKey = groupKeyFor(entityType, entityId);
  const now = new Date();

  const resolved = await tx.notification.updateMany({
    where: { groupKey, resolvedAt: null },
    data: { resolvedAt: now, resolvedById },
  });
  await tx.notification.updateMany({
    where: { groupKey, readAt: null },
    data: { readAt: now },
  });
  return resolved.count;
}
