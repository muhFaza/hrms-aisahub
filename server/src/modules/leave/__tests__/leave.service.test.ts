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

  // Leave is a full-time-only feature: every type is refused for a part-timer, who is paid
  // per logged hour and is therefore already unpaid for any day they do not log.
  it.each(['PAID', 'SICK', 'UNPAID'] as const)(
    'refuses %s leave for a part-time employee (400)',
    async (type) => {
      const { employee, user } = await createEmployeeWithUser({ employmentType: 'PART_TIME' });
      await expect(
        leaveService.submitLeave(authUser(user), {
          type,
          startDate: utc('2026-07-06'),
          endDate: utc('2026-07-07'),
          reason: null,
        }),
      ).rejects.toMatchObject({ status: 400, message: /only available to full-time/ });

      // Assert on stored state, not just the rejection: nothing may be written.
      const stored = await prisma.leaveRequest.count({ where: { employeeId: employee.id } });
      expect(stored).toBe(0);
    },
  );

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

  it('rejects a range overlapping an existing leave record (400)', async () => {
    const { employee, user } = await fullTimerWithThreeAccrualDays();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-08',
      totalDays: 3,
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

  it("does not treat another employee's overlapping record as a conflict", async () => {
    const { user } = await fullTimerWithThreeAccrualDays();
    const other = await createEmployee({ joinDate: utc('2026-05-10') });
    await createLeaveRequest({
      employeeId: other.id,
      startDate: '2026-07-06',
      endDate: '2026-07-10',
      totalDays: 5,
    });

    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-10'),
      reason: null,
    });
    expect(created.totalDays).toBe(5);
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
    expect(created).toMatchObject({ type: 'PAID', totalDays: 3 });
  });

  it('consumes the balance at submission, oldest-expiring row first', async () => {
    const employee = await createEmployee();
    const user = await createUser({ roleName: 'EMPLOYEE', employeeId: employee.id });
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

    await leaveService.submitLeave(authUser(user), {
      type: 'PAID',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-07'),
      reason: null,
    });

    const [later, earlier] = await Promise.all([
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: laterExpiry.id } }),
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: earlierExpiry.id } }),
    ]);
    expect(Number(earlier.daysConsumed)).toBe(2);
    expect(Number(later.daysConsumed)).toBe(0);
  });

  it('rolls the consumption back when the submission is rejected for lack of balance', async () => {
    // The guard, the consumption and the HR notification share one transaction, so a
    // rejected submission must leave the accrual untouched rather than half-spent, and
    // must not have told HR about leave that was never recorded.
    await createUser({ roleName: 'HR' });
    const employee = await createEmployee({ joinDate: utc('2026-07-05') });
    const user = await createUser({ roleName: 'EMPLOYEE', employeeId: employee.id });

    await expect(
      leaveService.submitLeave(authUser(user), {
        // Mon 6th - Fri 10th = 5 working days against the single accrued day.
        type: 'PAID',
        startDate: utc('2026-07-06'),
        endDate: utc('2026-07-10'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 400, message: /Insufficient leave balance/ });

    const consumed = await prisma.leaveAccrual.aggregate({
      where: { employeeId: employee.id },
      _sum: { daysConsumed: true },
    });
    expect(Number(consumed._sum.daysConsumed)).toBe(0);
    await expect(prisma.leaveRequest.count({ where: { employeeId: employee.id } })).resolves.toBe(0);
    await expect(prisma.notification.count()).resolves.toBe(0);
  });

  it('will not draw from an expired accrual', async () => {
    const employee = await createEmployee({ employmentType: 'FULL_TIME', isActive: false });
    const user = await createUser({ roleName: 'EMPLOYEE', employeeId: employee.id });
    // 5 unused days, but expired relative to the pinned "now". The employee is inactive
    // so the accrual catch-up cannot top the balance back up.
    const accrual = await createAccrual({
      employeeId: employee.id,
      period: '2024-01-01',
      expiresAt: '2025-07-01',
      days: 5,
    });

    await expect(
      leaveService.submitLeave(authUser(user), {
        type: 'PAID',
        startDate: utc('2026-07-06'),
        endDate: utc('2026-07-07'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 400, message: /Insufficient leave balance/ });

    const after = await prisma.leaveAccrual.findUniqueOrThrow({ where: { id: accrual.id } });
    expect(Number(after.daysConsumed)).toBe(0);
  });

  it('does not touch accruals when SICK leave is submitted', async () => {
    const { employee, user } = await fullTimerWithThreeAccrualDays();
    await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
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

  it('does not touch accruals when UNPAID leave is submitted', async () => {
    const { employee, user } = await fullTimerWithThreeAccrualDays();
    const created = await leaveService.submitLeave(authUser(user), {
      type: 'UNPAID',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-08'),
      reason: null,
    });
    expect(created).toMatchObject({ type: 'UNPAID', totalDays: 3 });

    const consumed = await prisma.leaveAccrual.aggregate({
      where: { employeeId: employee.id },
      _sum: { daysConsumed: true },
    });
    expect(Number(consumed._sum.daysConsumed)).toBe(0);
  });

  it('skips the balance check for UNPAID leave', async () => {
    // Only 1 accrued day, and 5 days requested: unpaid leave is not drawn from the pool.
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-07-05') });
    const created = await leaveService.submitLeave(authUser(user), {
      type: 'UNPAID',
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

describe('cancelLeave', () => {
  it('returns 404 for an unknown request', async () => {
    const { user } = await createEmployeeWithUser();
    await expect(leaveService.cancelLeave(999_999, authUser(user))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses to let an employee cancel someone else's leave (403)", async () => {
    const { user } = await createEmployeeWithUser();
    const victim = await createEmployee();
    const request = await createLeaveRequest({
      employeeId: victim.id,
      startDate: '2026-07-20',
      endDate: '2026-07-21',
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

  it('refunds exactly the days the cancelled PAID leave consumed', async () => {
    const { employee, user } = await fullTimerWithThreeAccrualDays();
    const before = await leaveService.getBalance(employee.id);

    const created = await leaveService.submitLeave(authUser(user), {
      // Mon 20th - Wed 22nd = 3 working days, all three accrued days.
      type: 'PAID',
      startDate: utc('2026-07-20'),
      endDate: utc('2026-07-22'),
      reason: null,
    });
    const during = await leaveService.getBalance(employee.id);
    expect(before.balance).toBe(3);
    expect(during.balance).toBe(0);

    await leaveService.cancelLeave(created.id, authUser(user));

    const after = await leaveService.getBalance(employee.id);
    expect(after.balance).toBe(before.balance);
    expect(after.usedTotal).toBe(0);
    await expect(prisma.leaveRequest.findUnique({ where: { id: created.id } })).resolves.toBeNull();
  });

  it('refunds the balance and tells HR in the same cancellation', async () => {
    // The refund and the notification work share one transaction; neither may land alone.
    const hr = await createUser({ roleName: 'HR' });
    const { employee, user } = await fullTimerWithThreeAccrualDays();
    const created = await leaveService.submitLeave(authUser(user), {
      type: 'PAID',
      startDate: utc('2026-07-20'),
      endDate: utc('2026-07-22'),
      reason: null,
    });

    await leaveService.cancelLeave(created.id, authUser(user));

    expect((await leaveService.getBalance(employee.id)).balance).toBe(3);

    const submitted = await prisma.notification.findFirstOrThrow({
      where: { type: 'LEAVE_SUBMITTED' },
    });
    expect(submitted.resolvedById).toBe(user.id);
    expect(submitted.resolvedAt).not.toBeNull();

    const cancelled = await prisma.notification.findFirstOrThrow({
      where: { type: 'REQUEST_CANCELLED' },
    });
    expect(cancelled).toMatchObject({ recipientId: hr.id, entityId: created.id, readAt: null });
    expect(cancelled.payload).toMatchObject({ kind: 'LEAVE' });
  });

  it('refunds the earliest-expiring live row first, not the newest', async () => {
    // Two leaves, so consumption has spilled over: A (Aug) is full and B (Dec) holds the
    // spill. Cancelling the first leave must unwind A, not B — refunding B would move a day
    // from the soon-expiring row to the long-lived one and invent spendable balance.
    // Inactive, so the accrual catch-up cannot add rows behind these two.
    const employee = await createEmployee({ isActive: false });
    const user = await createUser({ roleName: 'EMPLOYEE', employeeId: employee.id });
    const a = await createAccrual({
      employeeId: employee.id,
      period: '2025-02-01',
      expiresAt: '2026-08-01',
      days: 5,
    });
    const b = await createAccrual({
      employeeId: employee.id,
      period: '2025-06-01',
      expiresAt: '2026-12-01',
      days: 5,
    });

    const first = await leaveService.submitLeave(authUser(user), {
      // Mon 20th - Wed 22nd = 3 working days; FIFO drains them from A.
      type: 'PAID',
      startDate: utc('2026-07-20'),
      endDate: utc('2026-07-22'),
      reason: null,
    });
    await leaveService.submitLeave(authUser(user), {
      // Mon 27th - Wed 29th = 3 more; A takes 2 and B takes the remaining 1.
      type: 'PAID',
      startDate: utc('2026-07-27'),
      endDate: utc('2026-07-29'),
      reason: null,
    });

    const [aFull, bSpill] = await Promise.all([
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: a.id } }),
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: b.id } }),
    ]);
    expect(Number(aFull.daysConsumed)).toBe(5);
    expect(Number(bSpill.daysConsumed)).toBe(1);

    await leaveService.cancelLeave(first.id, authUser(user));

    const [aAfter, bAfter] = await Promise.all([
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: a.id } }),
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: b.id } }),
    ]);
    expect(Number(aAfter.daysConsumed)).toBe(2);
    expect(Number(bAfter.daysConsumed)).toBe(1);
  });

  it('refunds to live rows before expired ones', async () => {
    // The expired row carries consumption from some older leave. The cancelled leave can
    // only have drawn from the live row, so the whole refund belongs there.
    const employee = await createEmployee({ isActive: false });
    const user = await createUser({ roleName: 'EMPLOYEE', employeeId: employee.id });
    const expired = await createAccrual({
      employeeId: employee.id,
      period: '2024-01-01',
      expiresAt: '2025-07-01',
      days: 2,
      daysConsumed: 2,
    });
    const live = await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 3,
    });

    const created = await leaveService.submitLeave(authUser(user), {
      type: 'PAID',
      startDate: utc('2026-07-20'),
      endDate: utc('2026-07-21'),
      reason: null,
    });
    const liveConsumed = await prisma.leaveAccrual.findUniqueOrThrow({ where: { id: live.id } });
    expect(Number(liveConsumed.daysConsumed)).toBe(2);

    await leaveService.cancelLeave(created.id, authUser(user));

    const [liveAfter, expiredAfter] = await Promise.all([
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: live.id } }),
      prisma.leaveAccrual.findUniqueOrThrow({ where: { id: expired.id } }),
    ]);
    expect(Number(liveAfter.daysConsumed)).toBe(0);
    expect(Number(expiredAfter.daysConsumed)).toBe(2);
  });

  // Neither type consumed anything on the way in, so neither may manufacture balance on the
  // way out. Only PAID refunds.
  it.each(['SICK', 'UNPAID'] as const)(
    'refunds nothing when the cancelled leave is %s',
    async (type) => {
      const { employee, user } = await createEmployeeWithUser();
      const accrual = await createAccrual({
        employeeId: employee.id,
        period: '2026-01-01',
        expiresAt: '2027-07-01',
        days: 2,
        daysConsumed: 2,
      });
      const request = await createLeaveRequest({
        employeeId: employee.id,
        startDate: '2026-07-20',
        endDate: '2026-07-21',
        totalDays: 2,
        type,
      });

      await leaveService.cancelLeave(request.id, authUser(user));

      const after = await prisma.leaveAccrual.findUniqueOrThrow({ where: { id: accrual.id } });
      expect(Number(after.daysConsumed)).toBe(2);
    },
  );

  it('lets an employee cancel on the start date itself', async () => {
    const { employee, user } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      // "Now" is midday on the 15th; the window is inclusive of the first day.
      startDate: '2026-07-15',
      endDate: '2026-07-16',
      totalDays: 2,
      type: 'SICK',
    });

    await leaveService.cancelLeave(request.id, authUser(user));
    await expect(prisma.leaveRequest.findUnique({ where: { id: request.id } })).resolves.toBeNull();
  });

  it('refuses to let an employee cancel once the start date has passed (400)', async () => {
    const { employee, user } = await createEmployeeWithUser();
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-14',
      endDate: '2026-07-16',
      totalDays: 3,
      type: 'SICK',
    });

    await expect(leaveService.cancelLeave(request.id, authUser(user))).rejects.toMatchObject({
      status: 400,
      message: /up to and including its start date/,
    });
    await expect(
      prisma.leaveRequest.findUnique({ where: { id: request.id } }),
    ).resolves.not.toBeNull();
  });

  it('lets HR cancel past-dated leave, refunding the paid days', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    const accrual = await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 2,
      daysConsumed: 2,
    });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    await leaveService.cancelLeave(request.id, authUser(hr));

    await expect(prisma.leaveRequest.findUnique({ where: { id: request.id } })).resolves.toBeNull();
    const after = await prisma.leaveAccrual.findUniqueOrThrow({ where: { id: accrual.id } });
    expect(Number(after.daysConsumed)).toBe(0);
  });

  it('refuses to cancel inside a finalized payroll period (409)', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const { employee, user } = await createEmployeeWithUser();
    await finalizePeriod(2026, 7, hr.id);
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-20',
      endDate: '2026-07-21',
      totalDays: 2,
    });

    await expect(leaveService.cancelLeave(request.id, authUser(user))).rejects.toMatchObject({
      status: 409,
    });
  });

  it('blocks HR inside a finalized payroll period too (409)', async () => {
    // HR is exempt from the date window, not from the month lock: unwinding leave in a
    // closed month would contradict payslips that are already out.
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    await finalizePeriod(2026, 7, hr.id);
    const accrual = await createAccrual({
      employeeId: employee.id,
      period: '2026-01-01',
      expiresAt: '2027-07-01',
      days: 2,
      daysConsumed: 2,
    });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
    });

    await expect(leaveService.cancelLeave(request.id, authUser(hr))).rejects.toMatchObject({
      status: 409,
      message: /finalized/,
    });
    await expect(
      prisma.leaveRequest.findUnique({ where: { id: request.id } }),
    ).resolves.not.toBeNull();
    const after = await prisma.leaveAccrual.findUniqueOrThrow({ where: { id: accrual.id } });
    expect(Number(after.daysConsumed)).toBe(2);
  });

  // cancelLeave is deliberately not gated on employment type. Leave history survives an
  // employee converting to part-time, and HR must still be able to unwind a record.
  it('lets HR cancel a part-time employee\'s historical leave', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee({ employmentType: 'PART_TIME' });
    const request = await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'SICK',
    });

    await leaveService.cancelLeave(request.id, authUser(hr));
    await expect(prisma.leaveRequest.findUnique({ where: { id: request.id } })).resolves.toBeNull();
  });
});

describe('getBalance', () => {
  it('reports sickTaken and unpaidTaken as independent lifetime totals', async () => {
    const { employee } = await createEmployeeWithUser({ joinDate: utc('2026-05-10') });
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-06-08',
      endDate: '2026-06-09',
      totalDays: 2,
      type: 'SICK',
    });
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-06-15',
      endDate: '2026-06-17',
      totalDays: 3,
      type: 'UNPAID',
    });
    // PAID must not leak into either total.
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-06-22',
      endDate: '2026-06-23',
      totalDays: 2,
      type: 'PAID',
    });

    const balance = await leaveService.getBalance(employee.id);
    expect(balance.sickTaken).toBe(2);
    expect(balance.unpaidTaken).toBe(3);
  });

  it('reports zero for a type with no records', async () => {
    const { employee } = await createEmployeeWithUser({ joinDate: utc('2026-05-10') });
    const balance = await leaveService.getBalance(employee.id);
    expect(balance.sickTaken).toBe(0);
    expect(balance.unpaidTaken).toBe(0);
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

  it('filters by type', async () => {
    const hr = await createUser({ roleName: 'HR' });
    const employee = await createEmployee();
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      totalDays: 2,
      type: 'PAID',
    });
    await createLeaveRequest({
      employeeId: employee.id,
      startDate: '2026-07-13',
      endDate: '2026-07-14',
      totalDays: 2,
      type: 'SICK',
    });

    const sick = await leaveService.listLeave({ ...query, type: 'SICK' }, authUser(hr));
    expect(sick.total).toBe(1);
    expect(sick.data[0].startDate).toEqual(utc('2026-07-13'));
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

// Joint leave (cuti bersama) is a working day: the holiday row exists so the calendar can show
// it, not to excuse attendance. Leave taken across one therefore consumes that day.
describe('submitLeave — the off-day holiday policy', () => {
  it('counts a joint-leave day toward totalDays', async () => {
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-05-10') });
    await createHoliday('2026-07-08', 'Cuti Bersama', 'JOINT_LEAVE');

    const created = await leaveService.submitLeave(authUser(user), {
      // Mon 6th - Sun 12th: 5 weekdays, and the Wed cuti bersama is one of them.
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-12'),
      reason: null,
    });
    expect(created.totalDays).toBe(5);
  });

  it.each(['COMPANY', 'SPECIAL'] as const)('excludes a %s holiday from totalDays', async (type) => {
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-05-10') });
    await createHoliday('2026-07-08', 'Company day', type);

    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc('2026-07-06'),
      endDate: utc('2026-07-12'),
      reason: null,
    });
    expect(created.totalDays).toBe(4);
  });

  it('rejects a range whose only weekday is a national holiday, but accepts joint leave', async () => {
    const { user } = await createEmployeeWithUser({ joinDate: utc('2026-05-10') });
    await createHoliday('2026-07-08', 'National day', 'NATIONAL');
    await expect(
      leaveService.submitLeave(authUser(user), {
        type: 'SICK',
        startDate: utc('2026-07-08'),
        endDate: utc('2026-07-08'),
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 400, message: /no working days/ });

    await createHoliday('2026-07-09', 'Cuti Bersama', 'JOINT_LEAVE');
    const created = await leaveService.submitLeave(authUser(user), {
      type: 'SICK',
      startDate: utc('2026-07-09'),
      endDate: utc('2026-07-09'),
      reason: null,
    });
    expect(created.totalDays).toBe(1);
  });
});
