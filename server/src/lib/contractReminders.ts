import dayjs from 'dayjs';
import { prisma } from '../config/prisma';
import { groupKeyFor } from '../modules/notifications/emit';

// How far ahead of a contract's end date HR is warned.
export const REMINDER_LEAD_DAYS = 30;

// Arbitrary constant, unique to this job. Advisory locks are namespaced by the integer alone,
// so it only has to differ from any other advisory lock this application takes.
const REMINDER_LOCK_KEY = 4_820_117;

// Idempotent catch-up for contract-end reminders, modelled on ensureAccrualsUpToDate.
//
// There is no scheduler in this system — no cron, no queue, no timer. The established
// pattern is to work out what should exist by now and create only what is missing, then call
// it at boot and on the read paths that need freshness. That keeps the feature inside the
// app, adds no dependency, and survives container restarts.
//
// The tradeoff: if nobody opens the app for a week the reminder appears when they next do,
// rather than on the day it came due. For a 30-day-ahead warning this is immaterial.
//
// Idempotency comes from the reminder key, not a timestamp: one reminder per
// (recipient, employment, contractEndDate). Extending a contract changes the key, which
// re-arms the warning for the new date — exactly what should happen when HR renews.
export async function ensureContractRemindersUpToDate(): Promise<number> {
  const horizon = dayjs().startOf('day').add(REMINDER_LEAD_DAYS, 'day').toDate();

  return prisma.$transaction(async (tx) => {
    // This runs at boot AND on every HR notification fetch, including badge polls, so two
    // callers can overlap. Both would read an empty "already sent" set and both would insert.
    // A transaction-scoped advisory lock serializes them and releases automatically on commit
    // or rollback; the loser simply does nothing, because the winner has just done it.
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void and Prisma cannot
    // deserialize a void column, which fails the whole request rather than just the lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REMINDER_LOCK_KEY})`;

    // Open employments whose contract ends within the window. Already-expired contracts are
    // included deliberately: one that lapsed while nobody was looking is more urgent, not
    // less. `endDate: null` rather than "currently employed" is deliberate too — somebody
    // already serving notice needs no prompt to renew or terminate.
    const due = await tx.employment.findMany({
      where: { endDate: null, contractEndDate: { not: null, lte: horizon } },
      select: {
        id: true,
        contractEndDate: true,
        employee: { select: { id: true, fullName: true, nickname: true } },
      },
    });
    if (due.length === 0) return 0;

    const hrUsers = await tx.user.findMany({
      where: { isActive: true, role: { name: 'HR' } },
      select: { id: true },
    });
    if (hrUsers.length === 0) return 0;

    // One query for every candidate's existing reminders rather than one per employment.
    const existing = await tx.notification.findMany({
      where: {
        type: 'CONTRACT_ENDING',
        groupKey: { in: due.map((employment) => groupKeyFor('EMPLOYMENT', employment.id)) },
        resolvedAt: null,
      },
      select: { recipientId: true, groupKey: true, payload: true },
    });

    // Keyed per RECIPIENT, not merely per employment. Keying on the employment alone meant
    // that once one HR user held the reminder, an HR account created later was never sent
    // it — the key already existed, so nothing was emitted and no row was ever written for
    // them. They saw no expiring contract at all until the next one came due.
    const alreadyHeld = new Set(
      existing.map((notification) => {
        const payload = notification.payload as { contractEndDate?: string } | null;
        return `${notification.recipientId}:${notification.groupKey}@${payload?.contractEndDate ?? ''}`;
      }),
    );

    let emitted = 0;
    for (const employment of due) {
      const endDate = employment.contractEndDate as Date;
      const isoDate = endDate.toISOString().slice(0, 10);
      const groupKey = groupKeyFor('EMPLOYMENT', employment.id);

      const missing = hrUsers.filter(
        (user) => !alreadyHeld.has(`${user.id}:${groupKey}@${isoDate}`),
      );
      if (missing.length === 0) continue;

      const result = await tx.notification.createMany({
        data: missing.map((user) => ({
          recipientId: user.id,
          type: 'CONTRACT_ENDING' as const,
          entityType: 'EMPLOYMENT',
          entityId: employment.id,
          groupKey,
          payload: {
            employeeId: employment.employee.id,
            employeeName: employment.employee.fullName,
            employeeNickname: employment.employee.nickname,
            contractEndDate: isoDate,
            daysRemaining: dayjs(endDate).startOf('day').diff(dayjs().startOf('day'), 'day'),
          },
        })),
      });
      emitted += result.count;
    }

    return emitted;
  });
}
