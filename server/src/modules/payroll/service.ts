import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { AuthUser } from '../../middleware/auth';
import { fetchUsdToIdrRate } from '../../lib/fx';
import { renderPayrollSheet } from '../../lib/pdf/payrollSheet';
import { renderPayslip } from '../../lib/pdf/payslip';
import { periodKey } from '../../lib/pdf/theme';
import { renderPayoutCsv } from '../../lib/csv/payoutCsv';
import { emitToEmployees, type EmployeeTarget } from '../notifications/emit';
import { clipRangeToEmployments, isEmployedOnAny } from '../../lib/employment';
import type { CreatePeriodInput, PatchPeriodInput } from './schemas';
import {
  computePayslipRow,
  type ComputeContext,
  type PayrollEmployee,
  type PayslipDetail,
  type PayslipRow,
} from '../../lib/payroll';

// Used when the live FX lookup fails at period creation (design §4).
const FALLBACK_RATE = 16_000;
type PayrollDbClient = Prisma.TransactionClient | typeof prisma;

interface PeriodSummary {
  id: number;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  exchangeRate: number;
  rateSource: string;
  status: string;
  finalizedAt: Date | null;
  finalizedById: number | null;
  payslipCount: number;
  createdAt: Date;
}

function serializePeriod(period: {
  id: number;
  year: number;
  month: number;
  startDate: Date;
  endDate: Date;
  exchangeRate: Prisma.Decimal;
  rateSource: string;
  status: string;
  finalizedAt: Date | null;
  finalizedById: number | null;
  createdAt: Date;
  _count?: { payslips: number };
}): PeriodSummary {
  return {
    id: period.id,
    year: period.year,
    month: period.month,
    startDate: isoDate(period.startDate),
    endDate: isoDate(period.endDate),
    exchangeRate: Number(period.exchangeRate),
    rateSource: period.rateSource,
    status: period.status,
    finalizedAt: period.finalizedAt,
    finalizedById: period.finalizedById,
    payslipCount: period._count?.payslips ?? 0,
    createdAt: period.createdAt,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultPeriodRange(year: number, month: number): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(Date.UTC(year, month - 2, 26)),
    endDate: new Date(Date.UTC(year, month - 1, 25)),
  };
}

async function assertNoPeriodOverlap(
  startDate: Date,
  endDate: Date,
  excludeId?: number,
  client: PayrollDbClient = prisma,
): Promise<void> {
  const overlapping = await client.payrollPeriod.findFirst({
    where: {
      ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true },
  });
  if (overlapping) {
    throw new HttpError(409, 'Payroll period dates overlap an existing period');
  }
}

function isPeriodConstraintConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2004')
  );
}

export async function listPeriods(): Promise<PeriodSummary[]> {
  const periods = await prisma.payrollPeriod.findMany({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    include: { _count: { select: { payslips: true } } },
  });
  return periods.map(serializePeriod);
}

export async function createPeriod(input: CreatePeriodInput): Promise<PeriodSummary> {
  const { year, month } = input;
  const existing = await prisma.payrollPeriod.findUnique({
    where: { year_month: { year, month } },
  });
  if (existing) {
    throw new HttpError(409, `A payroll period for ${year}-${String(month).padStart(2, '0')} already exists`);
  }

  const liveRate = await fetchUsdToIdrRate();
  const exchangeRate = liveRate ?? FALLBACK_RATE;
  const rateSource = liveRate ? 'API' : 'FALLBACK';
  const range =
    input.startDate && input.endDate
      ? { startDate: input.startDate, endDate: input.endDate }
      : defaultPeriodRange(year, month);

  await assertNoPeriodOverlap(range.startDate, range.endDate);

  try {
    const created = await prisma.payrollPeriod.create({
      data: { year, month, ...range, exchangeRate, rateSource, status: 'DRAFT' },
      include: { _count: { select: { payslips: true } } },
    });
    return serializePeriod(created);
  } catch (error) {
    if (isPeriodConstraintConflict(error)) {
      throw new HttpError(409, 'Payroll period conflicts with an existing period');
    }
    throw error;
  }
}

export async function patchPeriod(id: number, input: PatchPeriodInput): Promise<PeriodSummary> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize edits with finalization. Without this row lock, both operations can observe
      // DRAFT and a late PATCH can change the range after payslips have been snapshotted.
      await tx.$queryRaw`SELECT id FROM "PayrollPeriod" WHERE id = ${id} FOR UPDATE`;
      const period = await tx.payrollPeriod.findUnique({ where: { id } });
      if (!period) {
        throw new HttpError(404, 'Payroll period not found');
      }
      if (period.status !== 'DRAFT') {
        throw new HttpError(409, 'Only draft periods can be edited');
      }

      const data: Prisma.PayrollPeriodUpdateInput = {};
      if (input.exchangeRate !== undefined) {
        data.exchangeRate = input.exchangeRate;
        data.rateSource = 'MANUAL';
      }
      if (input.startDate && input.endDate) {
        await assertNoPeriodOverlap(input.startDate, input.endDate, id, tx);
        data.startDate = input.startDate;
        data.endDate = input.endDate;
      }

      const updated = await tx.payrollPeriod.update({
        where: { id },
        data,
        include: { _count: { select: { payslips: true } } },
      });
      return serializePeriod(updated);
    });
  } catch (error) {
    if (isPeriodConstraintConflict(error)) {
      throw new HttpError(409, 'Payroll period conflicts with an existing period');
    }
    throw error;
  }
}

export async function deletePeriod(id: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PayrollPeriod" WHERE id = ${id} FOR UPDATE`;
    const period = await tx.payrollPeriod.findUnique({ where: { id } });
    if (!period) {
      throw new HttpError(404, 'Payroll period not found');
    }
    if (period.status !== 'DRAFT') {
      throw new HttpError(409, 'Finalized periods cannot be deleted');
    }
    await tx.payrollPeriod.delete({ where: { id } });
  });
}

// Gathers every source record touching the stored date range and computes a live preview row
// per active employee. Kept DB-side; the arithmetic lives in the pure payroll lib.
async function computeRows(
  exchangeRate: number,
  periodStart: Date,
  periodEnd: Date,
  client: PayrollDbClient = prisma,
): Promise<PayslipRow[]> {
  const [employees, overtimes, dailyLogs, reimbursements, leaves, holidays] = await Promise.all([
    // Anyone whose employment overlaps the range, not merely anyone currently employed.
    // Someone terminated during the range still earns the days they covered, and the old
    // isActive filter had no way to say that — it erased them from the month entirely.
    client.employee.findMany({
      where: {
        employments: {
          some: {
            startDate: { lte: periodEnd },
            OR: [{ endDate: null }, { endDate: { gte: periodStart } }],
          },
        },
      },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        nickname: true,
        employmentType: true,
        monthlySalary: true,
        hourlyRate: true,
        employments: {
          where: {
            startDate: { lte: periodEnd },
            OR: [{ endDate: null }, { endDate: { gte: periodStart } }],
          },
          select: { startDate: true, endDate: true },
        },
      },
    }),
    client.overtime.findMany({
      where: { status: 'APPROVED', date: { gte: periodStart, lte: periodEnd } },
      select: { id: true, employeeId: true, date: true, hours: true, status: true },
    }),
    client.dailyLog.findMany({
      where: { date: { gte: periodStart, lte: periodEnd } },
      select: { id: true, employeeId: true, date: true, hours: true },
    }),
    client.reimbursement.findMany({
      where: { status: 'APPROVED', date: { gte: periodStart, lte: periodEnd } },
      select: { id: true, employeeId: true, date: true, amount: true, status: true },
    }),
    // Leave can span months; include any record overlapping it. computePayslipRow clips each to
    // the in-period working days. Every type is fetched, not just the deducting ones: PAID
    // leave deducts nothing but is still a day absent in the attendance summary.
    client.leaveRequest.findMany({
      where: {
        startDate: { lte: periodEnd },
        endDate: { gte: periodStart },
      },
      select: { id: true, employeeId: true, type: true, startDate: true, endDate: true },
    }),
    // `type` is selected because it decides whether the day is worked — joint leave is.
    client.holiday.findMany({
      where: { date: { gte: periodStart, lte: periodEnd } },
      select: { date: true, type: true },
    }),
  ]);

  return employees.map((employee) => {
    const payrollEmployee: PayrollEmployee = {
      id: employee.id,
      fullName: employee.fullName,
      nickname: employee.nickname,
      employmentType: employee.employmentType,
      monthlySalary: employee.monthlySalary ? Number(employee.monthlySalary) : null,
      hourlyRate: employee.hourlyRate ? Number(employee.hourlyRate) : null,
    };
    // Everything dated is clipped to the days this employee was actually employed.
    //
    // Fetching by date range alone is not enough: a record can sit outside the employment,
    // most easily when a termination is recorded late, so entries were filed for days the
    // employee turns out not to have been employed for. Left unclipped, a sick leave running
    // past the last day deducts salary for days nobody was being paid for, and an overtime
    // entry dated after it pays somebody who had already left.
    const employed = (date: Date): boolean => isEmployedOnAny(employee.employments, date);

    const ctx: ComputeContext = {
      overtimes: overtimes
        .filter((o) => o.employeeId === employee.id && employed(o.date))
        .map((o) => ({ id: o.id, date: o.date, hours: Number(o.hours), status: o.status })),
      dailyLogs: dailyLogs
        .filter((l) => l.employeeId === employee.id && employed(l.date))
        .map((l) => ({ id: l.id, date: l.date, hours: Number(l.hours) })),
      reimbursements: reimbursements
        .filter((r) => r.employeeId === employee.id && employed(r.date))
        .map((r) => ({ id: r.id, date: r.date, amount: Number(r.amount), status: r.status })),
      // Leave is a RANGE, so it is truncated rather than dropped: a record spanning the last
      // day of employment still deducts the days that fall before it. One record can yield
      // more than one segment if it spans a termination and a rehire.
      leaves: leaves
        .filter((s) => s.employeeId === employee.id)
        .flatMap((s) =>
          clipRangeToEmployments(s.startDate, s.endDate, employee.employments).map(
            (segment) => ({
              id: s.id,
              type: s.type,
              startDate: segment.start,
              endDate: segment.end,
            }),
          ),
        ),
      holidays,
      employments: employee.employments,
      exchangeRate,
      periodStart,
      periodEnd,
    };
    return computePayslipRow(payrollEmployee, ctx);
  });
}

function totalsOf(rows: PayslipRow[]) {
  return {
    count: rows.length,
    totalIdr: rows.reduce((sum, r) => sum + r.totalIdr, 0),
    totalUsd: Math.round(rows.reduce((sum, r) => sum + r.totalUsd, 0) * 100) / 100,
  };
}

// A draft period has no payslip rows yet, so `payslipId` is present only once finalized. The
// UI keys its per-employee payslip download off it.
type PreviewRow = PayslipRow & { payslipId?: number };

// Reconstructs a preview row from a stored payslip so finalized periods return the same shape.
function rowFromPayslip(payslip: {
  id: number;
  employeeId: number;
  basicSalary: Prisma.Decimal;
  overtimePay: Prisma.Decimal;
  reimbursementTotal: Prisma.Decimal;
  leaveDeduction: Prisma.Decimal;
  totalIdr: Prisma.Decimal;
  totalUsd: Prisma.Decimal;
  detail: Prisma.JsonValue;
  employee: { fullName: string; nickname: string | null; employmentType: string };
}): PreviewRow {
  return {
    payslipId: payslip.id,
    employeeId: payslip.employeeId,
    name: payslip.employee.nickname ?? payslip.employee.fullName,
    employmentType: payslip.employee.employmentType as PayslipRow['employmentType'],
    basicSalary: Number(payslip.basicSalary),
    overtimePay: Number(payslip.overtimePay),
    reimbursementTotal: Number(payslip.reimbursementTotal),
    leaveDeduction: Number(payslip.leaveDeduction),
    totalIdr: Number(payslip.totalIdr),
    totalUsd: Number(payslip.totalUsd),
    detail: payslip.detail as unknown as PayslipDetail,
  };
}

export async function getPeriodPreview(id: number) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id },
    include: { _count: { select: { payslips: true } } },
  });
  if (!period) {
    throw new HttpError(404, 'Payroll period not found');
  }

  let rows: PreviewRow[];
  if (period.status === 'FINALIZED') {
    const payslips = await prisma.payslip.findMany({
      where: { payrollPeriodId: id },
      include: { employee: { select: { fullName: true, nickname: true, employmentType: true } } },
      orderBy: { employee: { fullName: 'asc' } },
    });
    rows = payslips.map(rowFromPayslip);
  } else {
    rows = await computeRows(Number(period.exchangeRate), period.startDate, period.endDate);
  }

  return { period: serializePeriod(period), rows, totals: totalsOf(rows) };
}

export async function finalizePeriod(id: number, finalizerUserId: number) {
  await prisma.$transaction(async (tx) => {
    // The same row lock is taken by PATCH and DELETE. This freezes the exact range and rate
    // before source rows are gathered, so the stored period, payslips and exports cannot diverge.
    await tx.$queryRaw`SELECT id FROM "PayrollPeriod" WHERE id = ${id} FOR UPDATE`;
    const period = await tx.payrollPeriod.findUnique({ where: { id } });
    if (!period) {
      throw new HttpError(404, 'Payroll period not found');
    }
    if (period.status !== 'DRAFT') {
      throw new HttpError(409, 'Only draft periods can be finalized');
    }

    const rows = await computeRows(
      Number(period.exchangeRate),
      period.startDate,
      period.endDate,
      tx,
    );

    // One transaction: snapshot every payslip, notify its owner, then flip the period to
    // FINALIZED. Source mutations lock overlapping period rows in shared mode, so they cannot
    // commit between this snapshot and the status transition.
    const targets: EmployeeTarget[] = [];
    for (const row of rows) {
      const payslip = await tx.payslip.create({
        data: {
          payrollPeriodId: id,
          employeeId: row.employeeId,
          basicSalary: row.basicSalary,
          overtimePay: row.overtimePay,
          reimbursementTotal: row.reimbursementTotal,
          leaveDeduction: row.leaveDeduction,
          totalIdr: row.totalIdr,
          totalUsd: row.totalUsd,
          detail: row.detail as unknown as Prisma.InputJsonValue,
        },
      });
      targets.push({
        employeeId: row.employeeId,
        entityId: payslip.id,
        payload: {
          year: period.year,
          month: period.month,
          totalIdr: row.totalIdr,
          totalUsd: row.totalUsd,
        },
      });
    }
    // One lookup and one insert for the whole run, not a pair per employee.
    await emitToEmployees(tx, {
      type: 'PAYSLIP_AVAILABLE',
      entityType: 'PAYSLIP',
      targets,
    });
    await tx.payrollPeriod.update({
      where: { id },
      data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedById: finalizerUserId },
    });
  });

  const finalized = await prisma.payrollPeriod.findUnique({
    where: { id },
    include: { _count: { select: { payslips: true } } },
  });
  const payslips = await prisma.payslip.findMany({
    where: { payrollPeriodId: id },
    include: { employee: { select: { fullName: true, nickname: true, employmentType: true } } },
    orderBy: { employee: { fullName: 'asc' } },
  });
  const finalizedRows = payslips.map(rowFromPayslip);
  return {
    period: serializePeriod(finalized!),
    rows: finalizedRows,
    totals: totalsOf(finalizedRows),
  };
}

// --- Exports -----------------------------------------------------------------------------
// Rendering lives in lib/ (database-free, unit-tested); these functions gather the rows,
// enforce the rules, and hand the controller a ready-to-send document.

export interface ExportDocument {
  filename: string;
  contentType: string;
  body: Buffer | string;
  included?: number;
  excluded?: number;
}

// Only a finalized period can be exported. A draft's numbers are recomputed on every read and
// would put a figure on a payment file that the next request could contradict.
async function loadFinalizedPeriod(id: number) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id },
    include: { finalizedBy: { select: { email: true } } },
  });
  if (!period) {
    throw new HttpError(404, 'Payroll period not found');
  }
  if (period.status !== 'FINALIZED') {
    throw new HttpError(409, 'Only finalized periods can be exported');
  }
  return period;
}

export async function exportPeriodPdf(id: number): Promise<ExportDocument> {
  const period = await loadFinalizedPeriod(id);
  const payslips = await prisma.payslip.findMany({
    where: { payrollPeriodId: id },
    include: { employee: { select: { fullName: true, nickname: true, employmentType: true } } },
    orderBy: { employee: { fullName: 'asc' } },
  });
  const rows = payslips.map(rowFromPayslip);
  const totals = totalsOf(rows);

  const body = await renderPayrollSheet({
    year: period.year,
    month: period.month,
    startDate: isoDate(period.startDate),
    endDate: isoDate(period.endDate),
    status: period.status,
    exchangeRate: Number(period.exchangeRate),
    rateSource: period.rateSource,
    finalizedAt: period.finalizedAt,
    finalizedByEmail: period.finalizedBy?.email ?? null,
    rows: rows.map((row) => ({
      employeeId: row.employeeId,
      name: row.name,
      employmentType: row.employmentType,
      basicSalary: row.basicSalary,
      overtimePay: row.overtimePay,
      reimbursementTotal: row.reimbursementTotal,
      leaveDeduction: row.leaveDeduction,
      totalIdr: row.totalIdr,
      totalUsd: row.totalUsd,
    })),
    totalIdr: totals.totalIdr,
    totalUsd: totals.totalUsd,
    generatedAt: new Date(),
  });

  return {
    filename: `payroll-${periodKey(period.year, period.month)}.pdf`,
    contentType: 'application/pdf',
    body,
  };
}

export async function exportPeriodCsv(id: number): Promise<ExportDocument> {
  const period = await loadFinalizedPeriod(id);
  const payslips = await prisma.payslip.findMany({
    where: { payrollPeriodId: id },
    include: {
      employee: {
        select: { fullName: true, email: true, bankName: true, bankAccountNumber: true },
      },
    },
    orderBy: { employee: { fullName: 'asc' } },
  });

  // Legal name, not the nickname the PDF shows: this is what the receiving bank matches on.
  const result = renderPayoutCsv(
    payslips.map((payslip) => ({
      employeeId: payslip.employeeId,
      fullName: payslip.employee.fullName,
      email: payslip.employee.email,
      bankName: payslip.employee.bankName,
      bankAccountNumber: payslip.employee.bankAccountNumber,
      totalIdr: Number(payslip.totalIdr),
      totalUsd: Number(payslip.totalUsd),
    })),
    period.year,
    period.month,
  );

  return {
    filename: `payout-${periodKey(period.year, period.month)}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: result.csv,
    included: result.included,
    excluded: result.excluded,
  };
}

export async function exportPayslipPdf(payslipId: number, actor: AuthUser): Promise<ExportDocument> {
  const payslip = await prisma.payslip.findUnique({
    where: { id: payslipId },
    include: {
      payrollPeriod: { select: { year: true, month: true, status: true } },
      employee: { select: { fullName: true, position: true, employmentType: true } },
    },
  });

  // 404 rather than 403 when someone requests a payslip that is not theirs: a 403 would confirm
  // the payslip exists, turning this endpoint into a headcount oracle.
  const isOwner = actor.employeeId !== null && payslip?.employeeId === actor.employeeId;
  if (!payslip || (actor.roleName !== 'HR' && !isOwner)) {
    throw new HttpError(404, 'Payslip not found');
  }
  if (payslip.payrollPeriod.status !== 'FINALIZED') {
    throw new HttpError(409, 'Only finalized periods can be exported');
  }

  const body = await renderPayslip({
    year: payslip.payrollPeriod.year,
    month: payslip.payrollPeriod.month,
    employeeName: payslip.employee.fullName,
    position: payslip.employee.position,
    employmentType: payslip.employee.employmentType,
    basicSalary: Number(payslip.basicSalary),
    overtimePay: Number(payslip.overtimePay),
    reimbursementTotal: Number(payslip.reimbursementTotal),
    leaveDeduction: Number(payslip.leaveDeduction),
    totalIdr: Number(payslip.totalIdr),
    totalUsd: Number(payslip.totalUsd),
    detail: payslip.detail as unknown as PayslipDetail,
    generatedAt: new Date(),
  });

  return {
    filename: `payslip-${periodKey(payslip.payrollPeriod.year, payslip.payrollPeriod.month)}-${payslip.employeeId}.pdf`,
    contentType: 'application/pdf',
    body,
  };
}

export async function getMyPayslips(actor: AuthUser) {
  if (!actor.employeeId) {
    return [];
  }
  const payslips = await prisma.payslip.findMany({
    where: { employeeId: actor.employeeId, payrollPeriod: { status: 'FINALIZED' } },
    include: { payrollPeriod: { select: { year: true, month: true, exchangeRate: true, finalizedAt: true } } },
    orderBy: [{ payrollPeriod: { year: 'desc' } }, { payrollPeriod: { month: 'desc' } }],
  });
  return payslips.map((payslip) => ({
    id: payslip.id,
    payrollPeriodId: payslip.payrollPeriodId,
    year: payslip.payrollPeriod.year,
    month: payslip.payrollPeriod.month,
    exchangeRate: Number(payslip.payrollPeriod.exchangeRate),
    finalizedAt: payslip.payrollPeriod.finalizedAt,
    basicSalary: Number(payslip.basicSalary),
    overtimePay: Number(payslip.overtimePay),
    reimbursementTotal: Number(payslip.reimbursementTotal),
    leaveDeduction: Number(payslip.leaveDeduction),
    totalIdr: Number(payslip.totalIdr),
    totalUsd: Number(payslip.totalUsd),
    detail: payslip.detail as unknown as PayslipDetail,
  }));
}
