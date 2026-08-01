import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { AuthUser } from '../../middleware/auth';
import { assertPeriodEditable } from '../../lib/periodLock';
import { assertEmployed } from '../../lib/employmentLock';
import type { DailyLogInput, ListDailyLogsQuery } from './schemas';

const logInclude = Prisma.validator<Prisma.DailyLogInclude>()({
  employee: { select: { fullName: true, nickname: true } },
});

type LogRow = Prisma.DailyLogGetPayload<{ include: typeof logInclude }>;

function serializeLog(log: LogRow) {
  return {
    id: log.id,
    employeeId: log.employeeId,
    employeeName: log.employee?.fullName ?? null,
    employeeNickname: log.employee?.nickname ?? null,
    date: log.date,
    hours: Number(log.hours),
    project: log.project,
    notes: log.notes,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
  };
}

// UTC-midnight date so @db.Date keys line up regardless of server timezone.
function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// [gte, lt) range covering the given YYYY-MM month.
function monthRange(month: string): { gte: Date; lt: Date } {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    gte: new Date(Date.UTC(year, monthNumber - 1, 1)),
    lt: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

export async function listDailyLogs(query: ListDailyLogsQuery, actor: AuthUser) {
  const where: Prisma.DailyLogWhereInput = {};
  if (query.month) where.date = monthRange(query.month);

  if (actor.roleName === 'HR') {
    if (query.employeeId) where.employeeId = query.employeeId;
  } else {
    if (!actor.employeeId) {
      return { data: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
    where.employeeId = actor.employeeId;
  }

  const [rows, total] = await Promise.all([
    prisma.dailyLog.findMany({
      where,
      include: logInclude,
      orderBy: { date: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.dailyLog.count({ where }),
  ]);

  return { data: rows.map(serializeLog), total, page: query.page, pageSize: query.pageSize };
}

export async function createDailyLog(actor: AuthUser, input: DailyLogInput) {
  if (!actor.employeeId) {
    throw new HttpError(400, 'No employee profile is linked to this account');
  }
  const employee = await prisma.employee.findUnique({ where: { id: actor.employeeId } });
  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }
  if (employee.employmentType !== 'PART_TIME') {
    throw new HttpError(403, 'Daily activity logging is only available to part-time employees');
  }

  const date = toUtcDate(input.date);
  await assertPeriodEditable(date);
  await assertEmployed(employee.id, date);

  const existing = await prisma.dailyLog.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date } },
  });
  if (existing) {
    throw new HttpError(409, 'A daily log already exists for this date');
  }

  const created = await prisma.dailyLog.create({
    data: {
      employeeId: employee.id,
      date,
      hours: input.hours,
      project: input.project,
      notes: input.notes ?? null,
    },
    include: logInclude,
  });
  return serializeLog(created);
}

export async function updateDailyLog(id: number, actor: AuthUser, input: DailyLogInput) {
  const log = await prisma.dailyLog.findUnique({ where: { id } });
  if (!log) {
    throw new HttpError(404, 'Daily log not found');
  }
  if (actor.roleName !== 'HR' && log.employeeId !== actor.employeeId) {
    throw new HttpError(403, 'You can only edit your own daily logs');
  }

  const nextDate = toUtcDate(input.date);
  // Lock covers both the existing month and, if the date moves, the destination month.
  await assertPeriodEditable(log.date);
  if (nextDate.getTime() !== log.date.getTime()) {
    await assertPeriodEditable(nextDate);
    const clash = await prisma.dailyLog.findUnique({
      where: { employeeId_date: { employeeId: log.employeeId, date: nextDate } },
    });
    if (clash) {
      throw new HttpError(409, 'A daily log already exists for this date');
    }
  }

  const updated = await prisma.dailyLog.update({
    where: { id },
    data: {
      date: nextDate,
      hours: input.hours,
      project: input.project,
      notes: input.notes ?? null,
    },
    include: logInclude,
  });
  return serializeLog(updated);
}

export async function deleteDailyLog(id: number, actor: AuthUser) {
  const log = await prisma.dailyLog.findUnique({ where: { id } });
  if (!log) {
    throw new HttpError(404, 'Daily log not found');
  }
  if (actor.roleName !== 'HR' && log.employeeId !== actor.employeeId) {
    throw new HttpError(403, 'You can only delete your own daily logs');
  }
  await assertPeriodEditable(log.date);
  await prisma.dailyLog.delete({ where: { id } });
}
