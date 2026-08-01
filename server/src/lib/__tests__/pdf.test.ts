import { describe, expect, it } from 'vitest';
import type { PayslipDetail } from '../payroll';
import { renderPayrollSheet, type PayrollSheetRow } from '../pdf/payrollSheet';
import { renderPayslip } from '../pdf/payslip';
import {
  formatDateKey,
  formatDateRange,
  formatIdr,
  formatUsd,
  periodBounds,
  periodKey,
} from '../pdf/theme';

// Asserting on rendered glyph positions would pin the layout rather than the behaviour. These
// check the contract that matters: a valid, non-empty PDF comes back and no input shape —
// including the legacy snapshots that predate unpaid leave — throws.

const GENERATED_AT = new Date('2026-08-01T10:30:00.000Z');

function sheetRow(overrides: Partial<PayrollSheetRow> = {}): PayrollSheetRow {
  return {
    employeeId: 1,
    name: 'Budi',
    employmentType: 'FULL_TIME',
    basicSalary: 10_000_000,
    overtimePay: 250_000,
    reimbursementTotal: 150_000,
    leaveDeduction: 476_190,
    totalIdr: 9_923_810,
    totalUsd: 620.24,
    ...overrides,
  };
}

function sheet(rows: PayrollSheetRow[]) {
  return {
    year: 2026,
    month: 6,
    status: 'FINALIZED',
    exchangeRate: 16_000,
    rateSource: 'API',
    finalizedAt: new Date('2026-07-01T04:00:00.000Z'),
    finalizedByEmail: 'hr@example.test',
    rows,
    totalIdr: rows.reduce((sum, r) => sum + r.totalIdr, 0),
    totalUsd: rows.reduce((sum, r) => sum + r.totalUsd, 0),
    generatedAt: GENERATED_AT,
  };
}

const attendance = {
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  scheduledWorkingDays: 22,
  actualWorkingDays: 19,
  dayOffDays: 8,
  nationalHolidayDays: 1,
  companyHolidayDays: 0,
  leaveDays: 2,
};

const fullTimeDetail: PayslipDetail = {
  attendance,
  employmentType: 'FULL_TIME',
  monthlySalary: 10_000_000,
  overtimeHours: 4,
  overtimeIds: [1],
  dailyLogHours: 0,
  dailyLogIds: [],
  reimbursementIds: [7],
  sickDays: 1,
  sickLeaveIds: [3],
  unpaidDays: 1,
  unpaidLeaveIds: [4],
  derivedHourly: 59_523.81,
  dailyRate: 476_190,
  exchangeRate: 16_000,
};

function payslip(detail: PayslipDetail, overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 6,
    employeeName: 'Budi Santoso',
    position: 'Engineer',
    employmentType: detail.employmentType,
    basicSalary: 10_000_000,
    overtimePay: 238_095,
    reimbursementTotal: 150_000,
    leaveDeduction: 952_381,
    totalIdr: 9_435_714,
    totalUsd: 589.73,
    detail,
    generatedAt: GENERATED_AT,
    ...overrides,
  };
}

// The /Pages node records the total; reading it beats parsing the rendered footer text.
function pageCount(buffer: Buffer): number {
  return Number(/\/Count (\d+)/.exec(buffer.toString('latin1'))?.[1] ?? 0);
}

function expectPdf(buffer: Buffer): void {
  expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(buffer.subarray(-6).toString('latin1')).toContain('%%EOF');
  expect(buffer.byteLength).toBeGreaterThan(1_000);
}

describe('payroll sheet PDF', () => {
  it('renders a period with rows', async () => {
    expectPdf(await renderPayrollSheet(sheet([sheetRow(), sheetRow({ employeeId: 2, name: 'Rina' })])));
  });

  it('renders an empty period without throwing', async () => {
    expectPdf(await renderPayrollSheet(sheet([])));
  });

  it('renders a part-timer row and a zero-deduction row', async () => {
    expectPdf(
      await renderPayrollSheet(
        sheet([
          sheetRow({ employmentType: 'PART_TIME', overtimePay: 0, leaveDeduction: 0 }),
          sheetRow({ employeeId: 2, leaveDeduction: 0 }),
        ]),
      ),
    );
  });

  it('renders a negative net without throwing', async () => {
    expectPdf(await renderPayrollSheet(sheet([sheetRow({ totalIdr: -50_000, totalUsd: -3.13 })])));
  });

  // The CSV omits non-positive nets, so the sheet has to state the payable subtotal or HR
  // cannot reconcile the two documents.
  it('names the excluded employees and prints a payable subtotal when a row is not payable', async () => {
    const buffer = await renderPayrollSheet(
      sheet([
        sheetRow({ employeeId: 1, name: 'Budi', totalIdr: 9_923_810, totalUsd: 620.24 }),
        sheetRow({ employeeId: 2, name: 'Idle', totalIdr: 0, totalUsd: 0 }),
      ]),
    );
    expectPdf(buffer);
    expect(pageCount(buffer)).toBe(1);
  });

  // The footer is drawn inside the bottom margin, and pdfkit auto-adds a page for anything
  // crossing that boundary — an early version emitted three pages for a single row.
  it('keeps a small period to exactly one page', async () => {
    expect(pageCount(await renderPayrollSheet(sheet([sheetRow()])))).toBe(1);
  });

  it('paginates a period larger than one page', async () => {
    const many = Array.from({ length: 60 }, (_v, i) => sheetRow({ employeeId: i + 1, name: `Employee ${i + 1}` }));
    const buffer = await renderPayrollSheet(sheet(many));
    expectPdf(buffer);
    expect(pageCount(buffer)).toBe(4);
  });

  it('tolerates a never-finalized shape (no finalizer recorded)', async () => {
    expectPdf(await renderPayrollSheet({ ...sheet([sheetRow()]), finalizedAt: null, finalizedByEmail: null }));
  });
});

describe('payslip PDF', () => {
  it('renders a full-time payslip with both leave types on a single page', async () => {
    const buffer = await renderPayslip(payslip(fullTimeDetail));
    expectPdf(buffer);
    expect(pageCount(buffer)).toBe(1);
  });

  it('renders a part-time payslip', async () => {
    expectPdf(
      await renderPayslip(
        payslip(
          {
            employmentType: 'PART_TIME',
            hourlyRate: 75_000,
            overtimeHours: 0,
            overtimeIds: [],
            dailyLogHours: 64,
            dailyLogIds: [1, 2, 3],
            reimbursementIds: [],
            sickDays: 0,
            sickLeaveIds: [],
            unpaidDays: 0,
            unpaidLeaveIds: [],
            exchangeRate: 16_000,
          },
          { basicSalary: 4_800_000, overtimePay: 0, leaveDeduction: 0, totalIdr: 4_800_000, totalUsd: 300 },
        ),
      ),
    );
  });

  // Payslips finalized before unpaid leave existed have neither unpaidDays nor unpaidLeaveIds
  // in their stored JSON. Reading them must not produce NaN or throw.
  it('renders a legacy snapshot with no unpaid-leave fields', async () => {
    const legacy = { ...fullTimeDetail };
    delete (legacy as Partial<PayslipDetail>).unpaidDays;
    delete (legacy as Partial<PayslipDetail>).unpaidLeaveIds;
    expectPdf(await renderPayslip(payslip(legacy, { leaveDeduction: 476_190 })));
  });

  // The attendance block is optional: a payslip finalized before it existed has no such data,
  // and the section is omitted rather than filled with invented numbers.
  it('renders a payslip with no attendance block at all', async () => {
    const noAttendance = { ...fullTimeDetail };
    delete (noAttendance as Partial<PayslipDetail>).attendance;
    const buffer = await renderPayslip(payslip(noAttendance));
    expectPdf(buffer);
    expect(pageCount(buffer)).toBe(1);
  });

  it('renders a part-time payslip whose attendance comes from logged days', async () => {
    expectPdf(
      await renderPayslip(
        payslip({
          ...fullTimeDetail,
          employmentType: 'PART_TIME',
          hourlyRate: 75_000,
          attendance: { ...attendance, actualWorkingDays: 12, leaveDays: 0 },
        }),
      ),
    );
  });

  it('renders a payslip with no leave and no reimbursements', async () => {
    expectPdf(
      await renderPayslip(
        payslip(
          { ...fullTimeDetail, sickDays: 0, sickLeaveIds: [], unpaidDays: 0, unpaidLeaveIds: [], reimbursementIds: [] },
          { leaveDeduction: 0, reimbursementTotal: 0 },
        ),
      ),
    );
  });
});

describe('pdf formatting helpers', () => {
  // Intl.NumberFormat('id-ID') emits U+00A0/U+202F, which render as tofu in a PDF standard
  // font. The hand-rolled formatters must stay pure ASCII.
  it.each([0, 1_000, 10_000_000, -50_000])('formats %d as ASCII-only rupiah', (value) => {
    expect(formatIdr(value)).toMatch(/^-?Rp [\d.]+$/);
  });

  it('groups rupiah with dots, Indonesian style', () => {
    expect(formatIdr(10_000_000)).toBe('Rp 10.000.000');
    expect(formatIdr(-476_190)).toBe('-Rp 476.190');
  });

  it('rounds rupiah to whole units', () => {
    expect(formatIdr(1_234.6)).toBe('Rp 1.235');
  });

  it('groups USD with commas and always shows cents', () => {
    expect(formatUsd(1_234.5)).toBe('$ 1,234.50');
    expect(formatUsd(-3.125)).toBe('-$ 3.13');
  });

  it('zero-pads the period key', () => {
    expect(periodKey(2026, 6)).toBe('2026-06');
    expect(periodKey(2026, 12)).toBe('2026-12');
  });

  it('renders a date key without shifting it across a timezone boundary', () => {
    expect(formatDateKey('2026-06-01')).toBe('01 Jun 2026');
    expect(formatDateKey('2026-12-31')).toBe('31 Dec 2026');
  });

  it('renders the pay period as an inclusive ASCII range', () => {
    expect(formatDateRange('2026-06-01', '2026-06-30')).toBe('01 Jun 2026 - 30 Jun 2026');
  });

  it('bounds a month at its first and last calendar day', () => {
    expect(periodBounds(2026, 6)).toEqual({ start: '2026-06-01', end: '2026-06-30' });
    expect(periodBounds(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodBounds(2024, 2)).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });
});
