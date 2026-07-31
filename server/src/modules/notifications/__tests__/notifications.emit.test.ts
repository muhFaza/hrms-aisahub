import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/prisma';
import {
  authUser,
  createEmployee,
  createEmployeeWithUser,
  createLeaveRequest,
  createUser,
  resetDb,
  utc,
} from '../../../__tests__/helpers/factories';
import * as leaveService from '../../leave/service';
import * as overtimeService from '../../overtime/service';
import * as reimbursementsService from '../../reimbursements/service';
import * as payrollService from '../../payroll/service';

// Covers the Core 8 events end to end: emission goes through the real domain services
// rather than the emit helpers, so a service that forgets to notify fails here.

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const JULY_MONDAY = '2026-07-06';
const JULY_TUESDAY = '2026-07-07';

async function draftPeriod(year: number, month: number) {
  return prisma.payrollPeriod.create({
    data: { year, month, exchangeRate: 16_000, status: 'DRAFT' },
  });
}

// Makes the database itself refuse writes to a table for the duration of `run`, so the
// atomicity assertions below turn on the transaction boundary rather than on how emit.ts
// happens to be written today. The constraint outlives resetDb's TRUNCATE, hence finally.
async function withRejectingWrites(
  table: string,
  check: string,
  run: () => Promise<void>,
): Promise<void> {
  const constraint = `${table.toLowerCase()}_atomicity_probe`;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}" CHECK (${check})`,
  );
  try {
    await run();
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${constraint}"`);
  }
}

describe('leave notifications', () => {
  it('H1: fans a submission out to every active HR account', async () => {
    const hrOne = await createUser({ roleName: 'HR' });
    const hrTwo = await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-01-01') });

    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc(JULY_MONDAY),
      endDate: utc(JULY_TUESDAY),
      reason: null,
    });

    const rows = await prisma.notification.findMany({ orderBy: { recipientId: 'asc' } });
    expect(rows.map((row) => row.recipientId)).toEqual([hrOne.id, hrTwo.id]);
    expect(new Set(rows.map((row) => row.groupKey))).toEqual(
      new Set([`LEAVE_REQUEST:${created.id}`]),
    );
  });

  it('H1: skips deactivated HR accounts and non-HR accounts', async () => {
    const activeHr = await createUser({ roleName: 'HR' });
    await createUser({ roleName: 'HR', isActive: false });
    await createEmployeeWithUser();
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-01-01') });

    await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc(JULY_MONDAY),
      endDate: utc(JULY_TUESDAY),
      reason: null,
    });

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientId).toBe(activeHr.id);
  });

  it('E1: notifies the requester when the decision is made', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { employee, user } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: JULY_MONDAY,
      endDate: JULY_TUESDAY,
      totalDays: 2,
      type: 'SICK',
    });

    await leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientId: user.id },
    });
    expect(notification.type).toBe('LEAVE_DECIDED');
    expect(notification.payload).toMatchObject({ status: 'APPROVED', leaveType: 'SICK' });
  });

  it('rolls the decision back when the notification write itself fails', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { employee } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: JULY_MONDAY,
      endDate: JULY_TUESDAY,
      totalDays: 2,
      type: 'SICK',
    });

    await withRejectingWrites('Notification', 'false', async () => {
      await expect(
        leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null }),
      ).rejects.toThrow();
    });

    // The decision only exists if its notification does.
    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('PENDING');
    await expect(prisma.notification.count()).resolves.toBe(0);
  });

  it('H4: announces a cancellation only when HR still had it pending', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-01-01') });
    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc(JULY_MONDAY),
      endDate: utc(JULY_TUESDAY),
      reason: null,
    });

    await leaveService.cancelLeave(created.id, authUser(user));

    const submitted = await prisma.notification.findFirstOrThrow({
      where: { type: 'LEAVE_SUBMITTED' },
    });
    expect(submitted.resolvedById).toBe(user.id);
    expect(submitted.resolvedAt).not.toBeNull();

    const cancelled = await prisma.notification.findFirstOrThrow({
      where: { type: 'REQUEST_CANCELLED' },
    });
    expect(cancelled.recipientId).toBe(hr.id);
    expect(cancelled.payload).toMatchObject({ kind: 'LEAVE' });
    expect(cancelled.readAt).toBeNull();
  });

  it('H4: stays silent when there was nothing for HR to resolve', async () => {
    // The request predates any HR account, so no submission notification exists.
    const { employee, user } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: JULY_MONDAY,
      endDate: JULY_TUESDAY,
      totalDays: 2,
    });
    await createUser({ roleName: 'HR' });

    await leaveService.cancelLeave(request.id, authUser(user));

    await expect(prisma.notification.count()).resolves.toBe(0);
  });
});

describe('overtime notifications', () => {
  it('H2: notifies HR on submission', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser();

    const created = await overtimeService.createOvertime(authUser(user), {
      date: utc(JULY_MONDAY),
      hours: 2,
      description: 'Release night',
    });

    const notification = await prisma.notification.findFirstOrThrow();
    expect(notification).toMatchObject({
      recipientId: hr.id,
      type: 'OVERTIME_SUBMITTED',
      entityType: 'OVERTIME',
      entityId: created.id,
      groupKey: `OVERTIME:${created.id}`,
    });
    expect(notification.payload).toMatchObject({ date: JULY_MONDAY, hours: 2 });
  });

  it('E2: notifies the employee on review and resolves the HR copies', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser();
    const created = await overtimeService.createOvertime(authUser(user), {
      date: utc(JULY_MONDAY),
      hours: 2,
      description: 'Release night',
    });

    await overtimeService.reviewOvertime(created.id, hr.id, {
      action: 'REJECT',
      rejectReason: 'Not approved in advance',
    });

    const decided = await prisma.notification.findFirstOrThrow({
      where: { recipientId: user.id },
    });
    expect(decided.type).toBe('OVERTIME_DECIDED');
    expect(decided.payload).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'Not approved in advance',
    });

    const submitted = await prisma.notification.findFirstOrThrow({
      where: { type: 'OVERTIME_SUBMITTED' },
    });
    expect(submitted.resolvedById).toBe(hr.id);
    expect(submitted.readAt).not.toBeNull();
  });

  it('H4: announces an overtime cancellation', async () => {
    await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser();
    const created = await overtimeService.createOvertime(authUser(user), {
      date: utc(JULY_MONDAY),
      hours: 2,
      description: 'Release night',
    });

    await overtimeService.cancelOvertime(created.id, authUser(user));

    const cancelled = await prisma.notification.findFirstOrThrow({
      where: { type: 'REQUEST_CANCELLED' },
    });
    expect(cancelled.payload).toMatchObject({ kind: 'OVERTIME' });
    expect(cancelled.entityId).toBe(created.id);
  });
});

describe('reimbursement notifications', () => {
  it('H3: notifies HR on submission', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser();

    const created = await reimbursementsService.createReimbursement(
      authUser(user),
      { date: utc(JULY_MONDAY), amount: 250_000, description: 'Client taxi' },
      'evidence.pdf',
    );

    const notification = await prisma.notification.findFirstOrThrow();
    expect(notification).toMatchObject({
      recipientId: hr.id,
      type: 'REIMBURSEMENT_SUBMITTED',
      entityId: created.id,
    });
    expect(notification.payload).toMatchObject({ title: 'Client taxi', amount: 250_000 });
  });

  it('E3: notifies the employee on review', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser();
    const created = await reimbursementsService.createReimbursement(
      authUser(user),
      { date: utc(JULY_MONDAY), amount: 250_000, description: 'Client taxi' },
      'evidence.pdf',
    );

    await reimbursementsService.reviewReimbursement(created.id, hr.id, {
      action: 'APPROVE',
      rejectReason: null,
    });

    const decided = await prisma.notification.findFirstOrThrow({
      where: { recipientId: user.id },
    });
    expect(decided.type).toBe('REIMBURSEMENT_DECIDED');
    expect(decided.payload).toMatchObject({ status: 'APPROVED', amount: 250_000 });
  });

  it('H4: announces a reimbursement cancellation', async () => {
    await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser();
    const created = await reimbursementsService.createReimbursement(
      authUser(user),
      { date: utc(JULY_MONDAY), amount: 250_000, description: 'Client taxi' },
      'evidence.pdf',
    );

    await reimbursementsService.cancelReimbursement(created.id, authUser(user));

    const cancelled = await prisma.notification.findFirstOrThrow({
      where: { type: 'REQUEST_CANCELLED' },
    });
    expect(cancelled.payload).toMatchObject({ kind: 'REIMBURSEMENT' });
  });
});

describe('payroll notifications', () => {
  it('E4: notifies every employee with an account when the period is finalized', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { user } = await createEmployeeWithUser();
    // Profile with no account: computed into the payroll run, but nobody to notify.
    await createEmployee();
    const period = await draftPeriod(2026, 7);

    await payrollService.finalizePeriod(period.id, hr.id);

    const rows = await prisma.notification.findMany({ where: { type: 'PAYSLIP_AVAILABLE' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientId).toBe(user.id);
    expect(rows[0].payload).toMatchObject({ year: 2026, month: 7 });
    expect(rows[0].entityType).toBe('PAYSLIP');
  });

  it('discards notifications already written when a later write fails', async () => {
    const hr = await createUser({ roleName: 'HR' });
    await createEmployeeWithUser();
    const period = await draftPeriod(2026, 7);

    // Notifications are written before the period flips to FINALIZED, so blocking that
    // flip fails the transaction with the notification rows already inserted in it.
    await withRejectingWrites('PayrollPeriod', `status <> 'FINALIZED'`, async () => {
      await expect(payrollService.finalizePeriod(period.id, hr.id)).rejects.toThrow();
    });

    await expect(prisma.notification.count()).resolves.toBe(0);
    await expect(prisma.payslip.count()).resolves.toBe(0);
    const after = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(after.status).toBe('DRAFT');
  });

  it('writes one row per employee in a single insert', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const first = await createEmployeeWithUser();
    const second = await createEmployeeWithUser();
    const period = await draftPeriod(2026, 7);

    await payrollService.finalizePeriod(period.id, hr.id);

    const rows = await prisma.notification.findMany({
      where: { type: 'PAYSLIP_AVAILABLE' },
      orderBy: { recipientId: 'asc' },
    });
    expect(rows.map((row) => row.recipientId)).toEqual(
      [first.user.id, second.user.id].sort((a, b) => a - b),
    );
    // Each row points at that employee's own payslip.
    for (const row of rows) {
      const payslip = await prisma.payslip.findUniqueOrThrow({ where: { id: row.entityId } });
      const recipient = await prisma.user.findUniqueOrThrow({ where: { id: row.recipientId } });
      expect(payslip.employeeId).toBe(recipient.employeeId);
    }
  });
});
