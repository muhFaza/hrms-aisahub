import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/prisma';
import {
  createEmployeeWithUser,
  createUser,
  resetDb,
  utc,
} from '../../../__tests__/helpers/factories';
import * as overtimeService from '../service';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function pendingOvertime(employeeId: number) {
  return prisma.overtime.create({
    data: { employeeId, date: utc('2026-07-06'), hours: 2, description: 'Release night' },
  });
}

describe('reviewOvertime — two reviewers racing', () => {
  it('lets exactly one reviewer win and 409s the other', async () => {
    const hrOne = await createUser({ roleName: 'HR' });
    const hrTwo = await createUser({ roleName: 'HR' });
    const { employee } = await createEmployeeWithUser();
    const overtime = await pendingOvertime(employee.id);

    const results = await Promise.allSettled([
      overtimeService.reviewOvertime(overtime.id, hrOne.id, {
        action: 'APPROVE',
        rejectReason: null,
      }),
      overtimeService.reviewOvertime(overtime.id, hrTwo.id, {
        action: 'REJECT',
        rejectReason: 'Not approved in advance',
      }),
    ]);

    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result) => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    // The loser's decision must not have partially landed: status and reviewer agree.
    const stored = await prisma.overtime.findUniqueOrThrow({ where: { id: overtime.id } });
    const winner = (winners[0] as PromiseFulfilledResult<{ status: string; reviewedById: number | null }>)
      .value;
    expect(stored.status).toBe(winner.status);
    expect(stored.reviewedById).toBe(winner.reviewedById);
  });

  it('notifies the employee exactly once', async () => {
    const hrOne = await createUser({ roleName: 'HR' });
    const hrTwo = await createUser({ roleName: 'HR' });
    const { employee, user } = await createEmployeeWithUser();
    const overtime = await pendingOvertime(employee.id);

    await Promise.allSettled([
      overtimeService.reviewOvertime(overtime.id, hrOne.id, {
        action: 'APPROVE',
        rejectReason: null,
      }),
      overtimeService.reviewOvertime(overtime.id, hrTwo.id, {
        action: 'APPROVE',
        rejectReason: null,
      }),
    ]);

    const notifications = await prisma.notification.findMany({
      where: { recipientId: user.id, type: 'OVERTIME_DECIDED' },
    });
    expect(notifications).toHaveLength(1);
  });
});
