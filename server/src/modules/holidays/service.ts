import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { HolidayInput, ListHolidaysQuery } from './schemas';

// Normalize to UTC midnight so @db.Date values stay stable regardless of input timezone.
function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function listHolidays(query: ListHolidaysQuery) {
  const where: Prisma.HolidayWhereInput = {};
  if (query.year !== undefined) {
    where.date = {
      gte: new Date(Date.UTC(query.year, 0, 1)),
      lt: new Date(Date.UTC(query.year + 1, 0, 1)),
    };
  }
  return prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
}

function buildData(input: HolidayInput): Prisma.HolidayUncheckedCreateInput {
  return {
    name: input.name,
    date: toUtcDate(input.date),
    type: input.type,
    notes: input.notes ?? null,
  };
}

export async function createHoliday(input: HolidayInput) {
  return prisma.holiday.create({ data: buildData(input) });
}

export async function updateHoliday(id: number, input: HolidayInput) {
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) {
    throw new HttpError(404, 'Holiday not found');
  }
  return prisma.holiday.update({ where: { id }, data: buildData(input) });
}

export async function deleteHoliday(id: number) {
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) {
    throw new HttpError(404, 'Holiday not found');
  }
  await prisma.holiday.delete({ where: { id } });
}
