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
import {
  computePayslipRow,
  type ComputeContext,
  type PayrollEmployee,
  type PayslipDetail,
  type PayslipRow,
} from '../../lib/payroll';

// Used when the live FX lookup fails at period creation (design §4).
const FALLBACK_RATE = 16_000;

interface PeriodSummary {
  id: number;
  year: number;
  month: number;
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
    exchangeRate: Number(period.exchangeRate),
    rateSource: period.rateSource,
    status: period.status,
    finalizedAt: period.finalizedAt,
    finalizedById: period.finalizedById,
    payslipCount: period._count?.payslips ?? 0,
    createdAt: period.createdAt,
  };
}

export async function listPeriods(): Promise<PeriodSummary[]> {
  const periods = await prisma.payrollPeriod.findMany({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    include: { _count: { select: { payslips: true } } },
  });
  return periods.map(serializePeriod);
}

export async function createPeriod(year: number, month: number): Promise<PeriodSummary> {
  const existing = await prisma.payrollPeriod.findUnique({
    where: { year_month: { year, month } },
  });
  if (existing) {
    throw new HttpError(409, `A payroll period for ${year}-${String(month).padStart(2, '0')} already exists`);
  }

  const liveRate = await fetchUsdToIdrRate();
  const exchangeRate = liveRate ?? FALLBACK_RATE;
  const rateSource = liveRate ? 'API' : 'FALLBACK';

  const created = await prisma.payrollPeriod.create({
    data: { year, month, exchangeRate, rateSource, status: 'DRAFT' },
    include: { _count: { select: { payslips: true } } },
  });
  return serializePeriod(created);
}

export async function patchRate(id: number, exchangeRate: number): Promise<PeriodSummary> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id } });
  if (!period) {
    throw new HttpError(404, 'Payroll period not found');
  }
  if (period.status !== 'DRAFT') {
    throw new HttpError(409, 'Only draft periods can have their exchange rate edited');
  }
  const updated = await prisma.payrollPeriod.update({
    where: { id },
    data: { exchangeRate, rateSource: 'MANUAL' },
    include: { _count: { select: { payslips: true } } },
  });
  return serializePeriod(updated);
}

export async function deletePeriod(id: number): Promise<void> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id } });
  if (!period) {
    throw new HttpError(404, 'Payroll period not found');
  }
  if (period.status !== 'DRAFT') {
    throw new HttpError(409, 'Finalized periods cannot be deleted');
  }
  await prisma.payrollPeriod.delete({ where: { id } });
}

// Gathers every source record touching the period month and computes a live preview row
// per active employee. Kept DB-side; the arithmetic lives in the pure payroll lib.
async function computeRows(
  exchangeRate: number,
  year: number,
  month: number,
): Promise<PayslipRow[]> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const [employees, overtimes, dailyLogs, reimbursements, leaves, holidays] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        nickname: true,
        employmentType: true,
        monthlySalary: true,
        hourlyRate: true,
      },
    }),
    prisma.overtime.findMany({
      where: { status: 'APPROVED', date: { gte: monthStart, lte: monthEnd } },
      select: { id: true, employeeId: true, date: true, hours: true, status: true },
    }),
    prisma.dailyLog.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
      select: { id: true, employeeId: true, date: true, hours: true },
    }),
    prisma.reimbursement.findMany({
      where: { status: 'APPROVED', date: { gte: monthStart, lte: monthEnd } },
      select: { id: true, employeeId: true, date: true, amount: true, status: true },
    }),
    // Leave can span months; include any record overlapping it. computePayslipRow clips each to
    // the in-period working days. Every type is fetched, not just the deducting ones: PAID
    // leave deducts nothing but is still a day absent in the attendance summary.
    prisma.leaveRequest.findMany({
      where: {
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: { id: true, employeeId: true, type: true, startDate: true, endDate: true },
    }),
    // `type` is selected because it decides whether the day is worked — joint leave is.
    prisma.holiday.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
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
    const ctx: ComputeContext = {
      overtimes: overtimes
        .filter((o) => o.employeeId === employee.id)
        .map((o) => ({ id: o.id, date: o.date, hours: Number(o.hours), status: o.status })),
      dailyLogs: dailyLogs
        .filter((l) => l.employeeId === employee.id)
        .map((l) => ({ id: l.id, date: l.date, hours: Number(l.hours) })),
      reimbursements: reimbursements
        .filter((r) => r.employeeId === employee.id)
        .map((r) => ({ id: r.id, date: r.date, amount: Number(r.amount), status: r.status })),
      leaves: leaves
        .filter((s) => s.employeeId === employee.id)
        .map((s) => ({
          id: s.id,
          type: s.type,
          startDate: s.startDate,
          endDate: s.endDate,
        })),
      holidays,
      exchangeRate,
      year,
      month,
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
    rows = await computeRows(Number(period.exchangeRate), period.year, period.month);
  }

  return { period: serializePeriod(period), rows, totals: totalsOf(rows) };
}

export async function finalizePeriod(id: number, finalizerUserId: number) {
  const period = await prisma.payrollPeriod.findUnique({ where: { id } });
  if (!period) {
    throw new HttpError(404, 'Payroll period not found');
  }
  if (period.status !== 'DRAFT') {
    throw new HttpError(409, 'Only draft periods can be finalized');
  }

  const exchangeRate = Number(period.exchangeRate);
  const rows = await computeRows(exchangeRate, period.year, period.month);

  // One transaction: snapshot every payslip, notify its owner, then flip the period to
  // FINALIZED (locks the month).
  await prisma.$transaction(async (tx) => {
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
