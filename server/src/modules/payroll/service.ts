import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import type { AuthUser } from '../../middleware/auth';
import { fetchUsdToIdrRate } from '../../lib/fx';
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

  const [employees, overtimes, dailyLogs, reimbursements, deductibleLeaves, holidays] = await Promise.all([
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
    // Deducting leave can span months; include any SICK or UNPAID record overlapping the
    // month. computePayslipRow clips each to the in-period working days.
    prisma.leaveRequest.findMany({
      where: {
        type: { in: ['SICK', 'UNPAID'] },
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: { id: true, employeeId: true, type: true, startDate: true, endDate: true },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
      select: { date: true },
    }),
  ]);

  const holidayDates = holidays.map((h) => h.date);

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
      deductibleLeaves: deductibleLeaves
        .filter((s) => s.employeeId === employee.id)
        .map((s) => ({
          id: s.id,
          type: s.type,
          startDate: s.startDate,
          endDate: s.endDate,
        })),
      holidays: holidayDates,
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

// Reconstructs a preview row from a stored payslip so finalized periods return the same shape.
function rowFromPayslip(payslip: {
  employeeId: number;
  basicSalary: Prisma.Decimal;
  overtimePay: Prisma.Decimal;
  reimbursementTotal: Prisma.Decimal;
  leaveDeduction: Prisma.Decimal;
  totalIdr: Prisma.Decimal;
  totalUsd: Prisma.Decimal;
  detail: Prisma.JsonValue;
  employee: { fullName: string; nickname: string | null; employmentType: string };
}): PayslipRow {
  return {
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

  let rows: PayslipRow[];
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
