import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/prisma';
import {
  createEmployeeWithUser,
  createUser,
  resetDb,
  utc,
} from '../../../__tests__/helpers/factories';
import * as reimbursementsService from '../service';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function pendingReimbursement(employeeId: number) {
  return prisma.reimbursement.create({
    data: {
      employeeId,
      date: utc('2026-07-06'),
      amount: 250_000,
      description: 'Client taxi',
      evidenceFilePath: 'evidence.pdf',
    },
  });
}

describe('reviewReimbursement — two reviewers racing', () => {
  it('lets exactly one reviewer win and 409s the other', async () => {
    const hrOne = await createUser({ roleName: 'HR' });
    const hrTwo = await createUser({ roleName: 'HR' });
    const { employee } = await createEmployeeWithUser();
    const reimbursement = await pendingReimbursement(employee.id);

    const results = await Promise.allSettled([
      reimbursementsService.reviewReimbursement(reimbursement.id, hrOne.id, {
        action: 'APPROVE',
        rejectReason: null,
      }),
      reimbursementsService.reviewReimbursement(reimbursement.id, hrTwo.id, {
        action: 'REJECT',
        rejectReason: 'Missing receipt',
      }),
    ]);

    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result) => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    // A reimbursement feeds payroll, so a half-applied decision would move money.
    const stored = await prisma.reimbursement.findUniqueOrThrow({
      where: { id: reimbursement.id },
    });
    const winner = (
      winners[0] as PromiseFulfilledResult<{ status: string; reviewedById: number | null }>
    ).value;
    expect(stored.status).toBe(winner.status);
    expect(stored.reviewedById).toBe(winner.reviewedById);
  });

  it('notifies the employee exactly once', async () => {
    const hrOne = await createUser({ roleName: 'HR' });
    const hrTwo = await createUser({ roleName: 'HR' });
    const { employee, user } = await createEmployeeWithUser();
    const reimbursement = await pendingReimbursement(employee.id);

    await Promise.allSettled([
      reimbursementsService.reviewReimbursement(reimbursement.id, hrOne.id, {
        action: 'APPROVE',
        rejectReason: null,
      }),
      reimbursementsService.reviewReimbursement(reimbursement.id, hrTwo.id, {
        action: 'APPROVE',
        rejectReason: null,
      }),
    ]);

    const notifications = await prisma.notification.findMany({
      where: { recipientId: user.id, type: 'REIMBURSEMENT_DECIDED' },
    });
    expect(notifications).toHaveLength(1);
  });
});
