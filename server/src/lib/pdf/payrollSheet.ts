import { isPayable } from '../csv/payoutCsv';
import {
  COLORS,
  PAGE_MARGIN,
  createDocument,
  documentToBuffer,
  drawField,
  drawFooters,
  drawHeader,
  formatDateKey,
  formatDateRange,
  formatIdr,
  formatPeriod,
  formatUsd,
  type Doc,
} from './theme';

// The HR-facing payroll sheet: one landscape page set listing every payslip in a finalized
// period, with the totals HR reconciles against the payout file.

export interface PayrollSheetRow {
  employeeId: number;
  name: string;
  employmentType: string;
  basicSalary: number;
  overtimePay: number;
  reimbursementTotal: number;
  leaveDeduction: number;
  totalIdr: number;
  totalUsd: number;
}

export interface PayrollSheetData {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  status: string;
  exchangeRate: number;
  rateSource: string;
  finalizedAt: Date | null;
  finalizedByEmail: string | null;
  rows: PayrollSheetRow[];
  totalIdr: number;
  totalUsd: number;
  generatedAt: Date;
}

interface Column {
  title: string;
  width: number;
  align: 'left' | 'right';
  value: (row: PayrollSheetRow) => string;
  negative?: boolean;
}

const COLUMNS: Column[] = [
  { title: 'Employee', width: 150, align: 'left', value: (r) => r.name },
  { title: 'Type', width: 70, align: 'left', value: (r) => (r.employmentType === 'FULL_TIME' ? 'Full-time' : 'Part-time') },
  { title: 'Basic', width: 90, align: 'right', value: (r) => formatIdr(r.basicSalary) },
  { title: 'Overtime', width: 80, align: 'right', value: (r) => formatIdr(r.overtimePay) },
  { title: 'Reimbursement', width: 90, align: 'right', value: (r) => formatIdr(r.reimbursementTotal) },
  {
    title: 'Deduction',
    width: 85,
    align: 'right',
    value: (r) => (r.leaveDeduction > 0 ? `-${formatIdr(r.leaveDeduction)}` : formatIdr(0)),
    negative: true,
  },
  { title: 'Net IDR', width: 100, align: 'right', value: (r) => formatIdr(r.totalIdr) },
  { title: 'Net USD', width: 80, align: 'right', value: (r) => formatUsd(r.totalUsd) },
];

const ROW_HEIGHT = 20;
const HEADER_HEIGHT = 22;

function drawTableHeader(doc: Doc, y: number): number {
  const width = COLUMNS.reduce((sum, c) => sum + c.width, 0);
  doc.rect(PAGE_MARGIN, y, width, HEADER_HEIGHT).fill(COLORS.band);
  let x = PAGE_MARGIN;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted);
  for (const column of COLUMNS) {
    doc.text(column.title.toUpperCase(), x + 6, y + 7, {
      width: column.width - 12,
      align: column.align,
      lineBreak: false,
    });
    x += column.width;
  }
  doc
    .moveTo(PAGE_MARGIN, y + HEADER_HEIGHT)
    .lineTo(PAGE_MARGIN + width, y + HEADER_HEIGHT)
    .strokeColor(COLORS.rule)
    .lineWidth(1)
    .stroke();
  return y + HEADER_HEIGHT + 4;
}

export async function renderPayrollSheet(data: PayrollSheetData): Promise<Buffer> {
  const doc = createDocument('landscape');
  const tableWidth = COLUMNS.reduce((sum, c) => sum + c.width, 0);

  let y = drawHeader(doc, 'Payroll Sheet', formatPeriod(data.year, data.month));

  const fieldWidth = 150;
  drawField(
    doc,
    'Pay period',
    formatDateRange(data.startDate, data.endDate),
    PAGE_MARGIN,
    y,
    fieldWidth * 1.4,
  );
  drawField(doc, 'Status', data.status, PAGE_MARGIN + fieldWidth * 1.4, y, fieldWidth * 0.7);
  drawField(
    doc,
    'Exchange rate',
    `${formatIdr(data.exchangeRate)} / USD 1.00 (${data.rateSource})`,
    PAGE_MARGIN + fieldWidth * 2.1,
    y,
    fieldWidth * 1.4,
  );
  drawField(
    doc,
    'Finalized',
    data.finalizedAt
      ? `${formatDateKey(data.finalizedAt.toISOString().slice(0, 10))}${data.finalizedByEmail ? ` by ${data.finalizedByEmail}` : ''}`
      : '-',
    PAGE_MARGIN + fieldWidth * 3.5,
    y,
    fieldWidth * 1.9,
  );

  y += 40;
  y = drawTableHeader(doc, y);

  // Reserve room for the totals band, the exclusion note and the footer so the last data row
  // can never collide with them; overflow starts a fresh page with a repeated column header.
  const bottomLimit = doc.page.height - PAGE_MARGIN - 80;

  doc.font('Helvetica').fontSize(9);
  for (const row of data.rows) {
    if (y + ROW_HEIGHT > bottomLimit) {
      doc.addPage();
      y = drawHeader(doc, 'Payroll Sheet', `${formatPeriod(data.year, data.month)} (continued)`);
      y = drawTableHeader(doc, y);
      doc.font('Helvetica').fontSize(9);
    }
    let x = PAGE_MARGIN;
    for (const column of COLUMNS) {
      const negative = column.negative === true && row.leaveDeduction > 0;
      doc.fillColor(negative ? COLORS.negative : COLORS.text);
      doc.text(column.value(row), x + 6, y + 5, {
        width: column.width - 12,
        align: column.align,
        lineBreak: false,
        ellipsis: true,
      });
      x += column.width;
    }
    doc.fillColor(COLORS.text);
    doc
      .moveTo(PAGE_MARGIN, y + ROW_HEIGHT)
      .lineTo(PAGE_MARGIN + tableWidth, y + ROW_HEIGHT)
      .strokeColor(COLORS.rule)
      .lineWidth(0.5)
      .stroke();
    y += ROW_HEIGHT;
  }

  if (data.rows.length === 0) {
    doc.fillColor(COLORS.muted).text('No payslips in this period.', PAGE_MARGIN + 6, y + 5);
    y += ROW_HEIGHT;
  }

  // Totals band, aligned to the two money columns.
  doc.rect(PAGE_MARGIN, y, tableWidth, HEADER_HEIGHT + 2).fill(COLORS.band);
  const labelWidth = COLUMNS.slice(0, 6).reduce((sum, c) => sum + c.width, 0);
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.text)
    .text(`Total — ${data.rows.length} employee${data.rows.length === 1 ? '' : 's'}`, PAGE_MARGIN + 6, y + 7, {
      width: labelWidth - 12,
      lineBreak: false,
    });
  doc.text(formatIdr(data.totalIdr), PAGE_MARGIN + labelWidth + 6, y + 7, {
    width: COLUMNS[6].width - 12,
    align: 'right',
    lineBreak: false,
  });
  doc.text(formatUsd(data.totalUsd), PAGE_MARGIN + labelWidth + COLUMNS[6].width + 6, y + 7, {
    width: COLUMNS[7].width - 12,
    align: 'right',
    lineBreak: false,
  });
  y += HEADER_HEIGHT + 2;

  // The payout CSV omits non-positive nets, so summing it would not reach the total above.
  // Printing the payable subtotal — by the same rule the CSV filters on — is what makes the
  // two documents reconcilable rather than merely close.
  const excluded = data.rows.filter((row) => !isPayable(row));
  if (excluded.length > 0) {
    const payable = data.rows.filter(isPayable);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        `Payout file excludes ${excluded.length} employee${excluded.length === 1 ? '' : 's'} with nothing payable ` +
          `(${excluded.map((row) => row.name).join(', ')}). ` +
          `Payable total: ${formatIdr(payable.reduce((sum, row) => sum + row.totalIdr, 0))} / ` +
          `${formatUsd(Math.round(payable.reduce((sum, row) => sum + row.totalUsd, 0) * 100) / 100)} ` +
          `across ${payable.length} employee${payable.length === 1 ? '' : 's'}.`,
        PAGE_MARGIN,
        y + 8,
        { width: tableWidth },
      );
  }

  drawFooters(doc, data.generatedAt);
  return documentToBuffer(doc);
}
