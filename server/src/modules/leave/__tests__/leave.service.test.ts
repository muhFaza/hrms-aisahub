import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../config/prisma';
import {
  authUser,
  createAccrual,
  createEmployee,
  createEmployeeWithUser,
  createHoliday,
  createLeaveRequest,
  createUser,
  finalizePeriod,
  resetDb,
  utc,
} from '../../../__tests__/helpers/factories';
import * as leaveService from '../service';

// July 2026 calendar used throughout (matches the countWorkingDays suite):
// 6th=Mon, 8th=Wed, 10th=Fri, 11th=Sat, 12th=Sun, 13th=Mon, 17th=Fri.
const NOW = new Date('2026-07-15T12:00:00.000Z');

// Accruals are generated from joinDate through the current month, so "now" has to
// be pinned or the expected balances drift as real time passes. Only Date is
// faked — timers stay real so Prisma's async I/O still resolves.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  await resetDb();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// joinDate 2026-05-10 + now in July 2026 => accruals for May, Jun, Jul = 3 days.
async function fullTimerWithThreeAccrualDays() {
  return createEmployeeWithUser({ joinDate: utc('2026-05-10') });
}

describe('submitLeave', () => {
  it('rejects an account with no linked employee profile (400)', async () => {
    const hr = await createUser({ roleName: 'HR' });
    await expect(
      leaveService.submitLeave(authUser(hr), {
        type: 'SICK',
        startDate: utc('2026-07-06'),
        endDate: utc('2026-07-07'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 400, message: /No employee profile/ });
  });

  it('rejects a token pointing at an employee that no longer exists (404)', async () => {
    const user = await createUser({ roleName: 'EMPLOYEE' });
    const actor = { ...authUser(user), employeeId: 999_999 };
    await expect(
      leaveService.submitLeave(actor, {
        type: 'SICK',
        startDate: utc('2026-07-06'),
        endDate: utc('2026-07-07'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses PAID leave for a part-time employee (400)', async () => {
    const { user } = await createEmployeeWithUser({ employmentType: 'PART_TIME' });
    await expect(
      leaveService.submitLeave(authUser(user), {
        type: 'PAID',
        startDate: utc('2026-07-06'),
        endDate: utc('2026-07-07'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 400, message: /only available to full-time/ });
  });

  it('allows SICK leave for a part-time employee', async () => {
    const { user } = await createEmployeeWithUser({ employmentType: 'PART_TIME' });
    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-07'),
      reason: 'flu',
    });
    expect(created).toMatchObject({ type: 'SICK', status: 'PENDING', totalDays: 2 });
  });

  it('rejects a range containing no working days (400)', async () => {
    const { user } = await fullTimerWithThreeAccrualDays();
    await expect(
      leaveService.submitLeave(authUser(user), {
        // Sat 11th - Sun 12th.
        type: 'SICK',
        startDate: utc('2026-07-11'),
        endDate: utc('2026-07-12'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 400, message: /no working days/ });
  });

  it('excludes weekends and holidays from totalDays', async () => {
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-05-10') });
    await createHoliday('2026-07-08', 'Mid-week holiday');

    const created = await leaveService.submitLeave(authUser(user), {
      // Mon 6th - Sun 12th: 5 weekdays, minus the Wed 8th holiday.
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-12'),
      reason: null,
    });
    expect(created.totalDays).toBe(4);
  });

  it('rejects a range overlapping an existing PENDING request (400)', async () => {
    const { employee, user } = await fullTimerWithThreeAccrualDays();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-08',
      totalDays: 3,
      status: 'PENDING',
    });

    await expect(
      leaveService.submitLeave(authUser(user), {
        type: 'SICK',
        startDate: utc('2026-07-08'),
        endDate: utc('2026-07-10'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 400, message: /overlaps an existing/ });
  });

  it('rejects a range overlapping an existing APPROVED request (400)', async () => {
    const { employee, user } = await fullTimerWithThreeAccrualDays();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-10',
      totalDays: 5,
      status: 'APPROVED',
    });

    await expect(
      leaveService.submitLeave(authUser(user), {
        type: 'SICK',
        startDate: utc('2026-07-09'),
        endDate: utc('2026-07-13'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 400, message: /overlaps an existing/ });
  });

  it('ignores a REJECTED request when checking for overlap', async () => {
    const { employee, user } = await fullTimerWithThreeAccrualDays();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-10',
      totalDays: 5,
      status: 'REJECTED',
    });

    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-10'),
      reason: null,
    });
    expect(created.status).toBe('PENDING');
  });

  it("does not treat another employee's overlapping request as a conflict", async () => {
    const { user } = await fullTimerWithThreeAccrualDays();
    const other = await createEmployee({ joinDate: utc('2026-05-10') });
    await createLeaveRequest({
      employeeId: other.id,
      startDate: '2026-07-06',
      endDate: '2026-07-10',
      totalDays: 5,
      status: 'APPROVED',
    });

    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-10'),
      reason: null,
    });
    expect(created.status).toBe('PENDING');
  });

  it('rejects PAID leave exceeding the accrued balance (400)', async () => {
    // Joined this month => exactly 1 accrued day against a 5-day request.
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-07-05') });
    await expect(
      leaveService.submitLeave(authUser(user), {
        type: 'PAID',
        startDate: utc('2026-07-06'),
        endDate: utc('2026-07-10'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 400, message: /Insufficient leave balance/ });
  });

  it('accepts PAID leave that exactly consumes the accrued balance', async () => {
    const { user } = await fullTimerWithThreeAccrualDays();
    const created = await leaveService.submitLeave(authUser(user), {
      // Mon 6th - Wed 8th = 3 working days against 3 accrued.
      type: 'PAID',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-08'),
      reason: null,
    });
    expect(created).toMatchObject({ type: 'PAID', status: 'PENDING', totalDays: 3 });
  });

  it('does not consume the balance until the request is approved', async () => {
    const { employee, user } = await fullTimerWithThreeAccrualDays();
    await leaveService.submitLeave(authUser(user), {
      type: 'PAID',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-08'),
      reason: null,
    });

    const consumed = await prisma.leaveAccrual.aggregate({
      where: { employeeId: employee.id },
      _sum: { daysConsumed: true },
    });
    expect(Number(consumed._sum.daysConsumed)).toBe(0);
  });

  it('skips the balance check for SICK leave', async () => {
    // Only 1 accrued day, but sick leave is not drawn from the accrual pool.
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-07-05') });
    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-10'),
      reason: null,
    });
    expect(created.totalDays).toBe(5);
  });

  it('notifies HR that a request was submitted', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { user } = await fullTimerWithThreeAccrualDays();
    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-07'),
      reason: 'flu',
    });

    const notifications = await prisma.notification.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      recipientId: hr.id,
      type: 'LEAVE_SUBMITTED',
      entityType: 'LEAVE_REQUEST',
      entityId: created.id,
      groupKey: `LEAVE_REQUEST:${created.id}`,
      readAt: null,
    });
    expect(notifications[0].payload).toMatchObject({
      leaveType: 'SICK',
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });
  });
});

describe('reviewLeave', () => {
  it('returns 404 for an unknown request', async () => {
    const hr = await createUser({ roleName: 'HR' });
    await expect(
      leaveService.reviewLeave(999_999, hr.id, { action: 'APPROVE', rejectReason: null }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each(['APPROVED', 'REJECTED'] as const)(
    'refuses to review a request already %s (400)',
    async (status) => {
      const hr = await createUser({ roleName: 'HR' });
      const employee = await createEmployee();
      const request = await createLeaveRequest({
        employeeId: employee.id,
        startDate: '2026-07-06',
        endDate: '2026-07-07',
        totalDays: 2,
        status,
      });

      await expect(
        leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null }),
      ).rejects.toMatchObject({ status: 400, message: /Only pending requests/ });
    },
  );

  it('records the reviewer and timestamp on approval', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    await createAccrual({ employeeId: employee.id, period: '2026-01-01', expiresAt: '2027-07-01', days: 2 });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    const updated = await leaveService.reviewLeave(request.id, hr.id, {
      action: 'APPROVE',
      rejectReason: null,
    });

    expect(updated.status).toBe('APPROVED');
    expect(updated.reviewedById).toBe(hr.id);
    expect(updated.reviewedAt).toEqual(NOW);
  });

  it('consumes accruals oldest-expiring first, not lowest-id first', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    // Created first but expiring later — FIFO must skip it while the other has room.
    const laterExpiry = await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-09-01',
      days: 2,
    });
    const earlierExpiry = await createAccrual({
      employeeId: employee.id,
      period: '2026-02-01',
      expiresAt: '2027-07-01',
      days: 2,
    });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    await leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null });

    const [later, earlier] = await Promise.all([
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: laterExpiry.id } }),
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: earlierExpiry.id } }),
    ]);
    expect(Number(earlier.daysConsumed)).toBe(2);
    expect(Number(later.daysConsumed)).toBe(0);
  });

  it('spills over into the next accrual when the first is partly used', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    const first = await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 2,
      daysConsumed: 1,
    });
    const second = await createAccrual({
      employeeId: employee.id,
      period: '2026-02-01',
      expiresAt: '2027-08-01',
      days: 2,
    });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-08',
      totalDays: 3,
    });

    await leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null });

    const [a, b] = await Promise.all([
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: second.id } }),
    ]);
    expect(Number(a.daysConsumed)).toBe(2);
    expect(Number(b.daysConsumed)).toBe(2);
  });

  it('will not draw from an expired accrual', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    // 5 unused days, but expired relative to the pinned "now".
    await createAccrual({
      employeeId: employee.id,
      period: '2024-01-01',
      expiresAt: '2025-07-01',
      days: 5,
    });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    await expect(
      leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null }),
    ).rejects.toMatchObject({ status: 400, message: /Insufficient leave balance/ });
  });

  it('leaves the request PENDING when approval fails for lack of balance', async () => {
    // The balance check at submit time can go stale; the transaction must roll the
    // status change back rather than approving leave it cannot fund.
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    await createAccrual({ employeeId: employee.id, period: '2026-01-01', expiresAt: '2027-07-01', days: 1 });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-10',
      totalDays: 5,
    });

    await expect(
      leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null }),
    ).rejects.toMatchObject({ status: 400 });

    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('PENDING');
  });

  it('does not touch accruals when approving SICK leave', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    const accrual = await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 2,
    });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    await leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null });

    const after = await prisma.leaveAccrual.findUniqueOrThrow({ where: { id: accrual.id } });
    expect(Number(after.daysConsumed)).toBe(0);
  });

  it('stores the reject reason and consumes nothing when rejecting', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    const accrual = await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 2,
    });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    const updated = await leaveService.reviewLeave(request.id, hr.id, {
      action: 'REJECT',
      rejectReason: 'Team is short-staffed that week',
    });

    expect(updated).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'Team is short-staffed that week',
    });
    const after = await prisma.leaveAccrual.findUniqueOrThrow({ where: { id: accrual.id } });
    expect(Number(after.daysConsumed)).toBe(0);
  });

  it('blocks review when the start month is in a finalized payroll period (409)', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    await finalizePeriod(2026, 7, hr.id);
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    await expect(
      leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null }),
    ).rejects.toMatchObject({ status: 409, message: /finalized/ });
  });

  it('allows review when a different month is finalized', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    await finalizePeriod(2026, 6, hr.id);
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    const updated = await leaveService.reviewLeave(request.id, hr.id, {
      action: 'APPROVE',
      rejectReason: null,
    });
    expect(updated.status).toBe('APPROVED');
  });

  it('notifies the employee of the decision', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { employee, user } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    await leaveService.reviewLeave(request.id, hr.id, {
      action: 'REJECT',
      rejectReason: 'Team is short-staffed',
    });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientId: user.id },
    });
    expect(notification).toMatchObject({
      type: 'LEAVE_DECIDED',
      entityType: 'LEAVE_REQUEST',
      entityId: request.id,
      groupKey: null,
    });
    expect(notification.payload).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'Team is short-staffed',
      totalDays: 2,
    });
  });

  it('skips the decision notification when the employee has no account', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    await leaveService.reviewLeave(request.id, hr.id, { action: 'APPROVE', rejectReason: null });
    await expect(prisma.notification.count()).resolves.toBe(0);
  });

  it("marks HR's submitted notifications resolved once a decision is made", async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { user } = await fullTimerWithThreeAccrualDays();
    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-07'),
      reason: null,
    });

    await leaveService.reviewLeave(created.id, hr.id, { action: 'APPROVE', rejectReason: null });

    const hrNotification = await prisma.notification.findFirstOrThrow({
      where: { recipientId: hr.id, type: 'LEAVE_SUBMITTED' },
    });
    expect(hrNotification.resolvedById).toBe(hr.id);
    expect(hrNotification.resolvedAt).not.toBeNull();
    expect(hrNotification.readAt).not.toBeNull();
  });
});

describe('reviewLeave — two reviewers racing', () => {
  // Both calls issue their pre-read before either opens its transaction, so both pass the
  // "is it PENDING?" check. The conditional update inside the transaction is what decides.
  async function raceApprovals(requestId: number, first: number, second: number) {
    return Promise.allSettled([
      leaveService.reviewLeave(requestId, first, { action: 'APPROVE', rejectReason: null }),
      leaveService.reviewLeave(requestId, second, { action: 'APPROVE', rejectReason: null }),
    ]);
  }

  it('lets exactly one reviewer win and 409s the other', async () => {
    const hrOne = await createUser({ roleName: 'HR' });
    const hrTwo = await createUser({ roleName: 'HR' });
    const { employee } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    const results = await raceApprovals(request.id, hrOne.id, hrTwo.id);

    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result) => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    const stored = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.status).toBe('APPROVED');
    // The stored reviewer is whichever call actually committed.
    expect([hrOne.id, hrTwo.id]).toContain(stored.reviewedById);
  });

  it('consumes the paid-leave balance exactly once', async () => {
    const hrOne = await createUser({ roleName: 'HR' });
    const hrTwo = await createUser({ roleName: 'HR' });
    const { employee } = await createEmployeeWithUser();
    // Deliberately roomy: 4 days available against a 2-day request, so a double
    // consumption would land at 4 rather than being masked by the CHECK constraint.
    await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 4,
    });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'PAID',
    });

    await raceApprovals(request.id, hrOne.id, hrTwo.id);

    const consumed = await prisma.leaveAccrual.aggregate({
      where: { employeeId: employee.id },
      _sum: { daysConsumed: true },
    });
    expect(Number(consumed._sum.daysConsumed)).toBe(2);
  });

  it('notifies the employee exactly once', async () => {
    const hrOne = await createUser({ roleName: 'HR' });
    const hrTwo = await createUser({ roleName: 'HR' });
    const { employee, user } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    await raceApprovals(request.id, hrOne.id, hrTwo.id);

    const notifications = await prisma.notification.findMany({
      where: { recipientId: user.id, type: 'LEAVE_DECIDED' },
    });
    expect(notifications).toHaveLength(1);
  });
});

describe('cancelLeave', () => {
  it('returns 404 for an unknown request', async () => {
    const { user } = await createEmployeeWithUser();
    await expect(leaveService.cancelLeave(999_999, authUser(user))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses to let an employee cancel someone else's request (403)", async () => {
    const { user } = await createEmployeeWithUser();
    const victim = await createEmployee();
    const request = await createLeaveRequest({
      employeeId: victim.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    await expect(leaveService.cancelLeave(request.id, authUser(user))).rejects.toMatchObject({
      status: 403,
      message: /only cancel your own/,
    });
    await expect(
      prisma.leaveRequest.findUnique({ where: { id: request.id } }),
    ).resolves.not.toBeNull();
  });

  it('lets an employee cancel their own pending request', async () => {
    const { employee, user } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    await leaveService.cancelLeave(request.id, authUser(user));
    await expect(prisma.leaveRequest.findUnique({ where: { id: request.id } })).resolves.toBeNull();
  });

  it("lets HR cancel another employee's pending request", async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    await leaveService.cancelLeave(request.id, authUser(hr));
    await expect(prisma.leaveRequest.findUnique({ where: { id: request.id } })).resolves.toBeNull();
  });

  it('refuses to cancel an already-approved request (400)', async () => {
    const { employee, user } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      status: 'APPROVED',
    });

    await expect(leaveService.cancelLeave(request.id, authUser(user))).rejects.toMatchObject({
      status: 400,
      message: /Only pending requests/,
    });
  });

  it('refuses to cancel inside a finalized payroll period (409)', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { employee, user } = await createEmployeeWithUser();
    await finalizePeriod(2026, 7, hr.id);
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    await expect(leaveService.cancelLeave(request.id, authUser(user))).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('listLeave', () => {
  const query = { page: 1, pageSize: 20 } as const;

  it('scopes an employee to their own requests', async () => {
    const { employee, user } = await createEmployeeWithUser();
    const other = await createEmployee();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });
    await createLeaveRequest({
      employeeId: other.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    const result = await leaveService.listLeave({ ...query }, authUser(user));
    expect(result.total).toBe(1);
    expect(result.data[0].employeeId).toBe(employee.id);
  });

  it("ignores an employeeId filter aimed at another employee's records", async () => {
    // The filter is attacker-controlled; the service must overwrite it rather
    // than trust it, or any employee could read a colleague's leave history.
    const { employee, user } = await createEmployeeWithUser();
    const other = await createEmployee();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });
    await createLeaveRequest({
      employeeId: other.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    const result = await leaveService.listLeave(
      { ...query, employeeId: other.id },
      authUser(user),
    );
    expect(result.total).toBe(1);
    expect(result.data[0].employeeId).toBe(employee.id);
  });

  it('returns nothing for an account with no employee profile', async () => {
    const orphan = await createUser({ roleName: 'EMPLOYEE' });
    const employee = await createEmployee();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    const result = await leaveService.listLeave({ ...query }, authUser(orphan));
    expect(result).toMatchObject({ data: [], total: 0 });
  });

  it('shows HR every employee’s requests', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const a = await createEmployee();
    const b = await createEmployee();
    for (const employee of [a, b]) {
      await createLeaveRequest({
        employeeId: employee.id,
        startDate: '2026-07-06',
        endDate: '2026-07-07',
        totalDays: 2,
      });
    }

    const result = await leaveService.listLeave({ ...query }, authUser(hr));
    expect(result.total).toBe(2);
  });

  it('honours an employeeId filter for HR', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const a = await createEmployee();
    const b = await createEmployee();
    for (const employee of [a, b]) {
      await createLeaveRequest({
        employeeId: employee.id,
        startDate: '2026-07-06',
        endDate: '2026-07-07',
        totalDays: 2,
      });
    }

    const result = await leaveService.listLeave({ ...query, employeeId: b.id }, authUser(hr));
    expect(result.total).toBe(1);
    expect(result.data[0].employeeId).toBe(b.id);
  });

  it('filters by status and type', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      status: 'APPROVED',
      type: 'PAID',
    });
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-13',
      endDate: '2026-07-14',
      totalDays: 2,
      status: 'PENDING',
      type: 'SICK',
    });

    const approved = await leaveService.listLeave({ ...query, status: 'APPROVED' }, authUser(hr));
    expect(approved.total).toBe(1);
    expect(approved.data[0].type).toBe('PAID');

    const sick = await leaveService.listLeave({ ...query, type: 'SICK' }, authUser(hr));
    expect(sick.total).toBe(1);
    expect(sick.data[0].status).toBe('PENDING');
  });

  it('paginates while reporting the unpaginated total', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    for (const day of ['2026-07-06', '2026-07-13', '2026-07-20']) {
      await createLeaveRequest({
        employeeId: employee.id,
        startDate: day,
        endDate: day,
        totalDays: 1,
      });
    }

    const page2 = await leaveService.listLeave({ page: 2, pageSize: 2 }, authUser(hr));
    expect(page2.total).toBe(3);
    expect(page2.data).toHaveLength(1);
  });
});
