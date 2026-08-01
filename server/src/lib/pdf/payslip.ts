import { splitLeaveDeduction, type PayslipDetail } from '../payroll';
import {
  COLORS,
  COMPANY,
  PAGE_MARGIN,
  createDocument,
  documentToBuffer,
  drawField,
  drawFooters,
  drawHeader,
  formatIdr,
  formatPeriod,
  formatUsd,
  type Doc,
} from './theme';

// The employee-facing payslip. Deliberately carries no bank account and no KTP: the employee
// gains nothing from either, and a downloaded PDF is a forwarding path.

export interface PayslipData {
  year: number;
  month: number;
  employeeName: string;
  position: string;
  employmentType: string;
  basicSalary: number;
  overtimePay: number;
  reimbursementTotal: number;
  leaveDeduction: number;
  totalIdr: number;
  totalUsd: number;
  detail: PayslipDetail;
  generatedAt: Date;
}

interface Line {
  label: string;
  note?: string;
  amount: number;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function drawSection(doc: Doc, title: string, lines: Line[], y: number, width: number, negative: boolean): number {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted).text(title.toUpperCase(), PAGE_MARGIN, y);
  let cursor = y + 16;

  doc.fontSize(10);
  for (const line of lines) {
    doc.font('Helvetica').fillColor(COLORS.text).text(line.label, PAGE_MARGIN + 4, cursor, {
      width: width * 0.45,
      lineBreak: false,
    });
    if (line.note) {
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(line.note, PAGE_MARGIN + 4 + width * 0.45, cursor + 1, {
        width: width * 0.3,
        lineBreak: false,
      });
      doc.fontSize(10);
    }
    doc
      .font('Helvetica')
      .fillColor(negative && line.amount !== 0 ? COLORS.negative : COLORS.text)
      .text(`${negative && line.amount !== 0 ? '-' : ''}${formatIdr(line.amount)}`, PAGE_MARGIN, cursor, {
        width,
        align: 'right',
        lineBreak: false,
      });
    cursor += 18;
  }

  if (lines.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('None', PAGE_MARGIN + 4, cursor);
    cursor += 18;
  }

  doc.moveTo(PAGE_MARGIN, cursor + 2).lineTo(PAGE_MARGIN + width, cursor + 2).strokeColor(COLORS.rule).lineWidth(0.5).stroke();
  doc.fillColor(COLORS.text);
  return cursor + 14;
}

export async function renderPayslip(data: PayslipData): Promise<Buffer> {
  const doc = createDocument('portrait');
  const width = doc.page.width - PAGE_MARGIN * 2;
  const { detail } = data;
  const isFullTime = data.employmentType === 'FULL_TIME';

  let y = drawHeader(doc, 'Payslip', formatPeriod(data.year, data.month));

  const fieldWidth = width / 3;
  drawField(doc, 'Employee', data.employeeName, PAGE_MARGIN, y, fieldWidth);
  drawField(doc, 'Position', data.position, PAGE_MARGIN + fieldWidth, y, fieldWidth);
  drawField(
    doc,
    'Employment type',
    isFullTime ? 'Full-time' : 'Part-time',
    PAGE_MARGIN + fieldWidth * 2,
    y,
    fieldWidth,
  );
  y += 40;
  drawField(doc, 'Pay period', formatPeriod(data.year, data.month), PAGE_MARGIN, y, fieldWidth);
  drawField(
    doc,
    'Exchange rate',
    `${formatIdr(detail.exchangeRate)} / USD 1.00`,
    PAGE_MARGIN + fieldWidth,
    y,
    fieldWidth * 2,
  );
  y += 46;

  const earnings: Line[] = [];
  if (isFullTime) {
    earnings.push({ label: 'Basic salary', note: 'Monthly', amount: data.basicSalary });
    if (data.overtimePay > 0 || detail.overtimeHours > 0) {
      earnings.push({
        label: 'Overtime',
        note: `${detail.overtimeHours} h · ${detail.overtimeIds.length} entr${detail.overtimeIds.length === 1 ? 'y' : 'ies'}`,
        amount: data.overtimePay,
      });
    }
  } else {
    earnings.push({
      label: 'Logged hours',
      note: `${detail.dailyLogHours} h @ ${formatIdr(detail.hourlyRate ?? 0)} · ${plural(detail.dailyLogIds.length, 'log')}`,
      amount: data.basicSalary,
    });
  }
  if (data.reimbursementTotal > 0 || detail.reimbursementIds.length > 0) {
    earnings.push({
      label: 'Reimbursements',
      note: `${plural(detail.reimbursementIds.length, 'claim')} approved`,
      amount: data.reimbursementTotal,
    });
  }
  y = drawSection(doc, 'Earnings', earnings, y, width, false);

  const split = splitLeaveDeduction(detail, data.leaveDeduction);
  const deductions: Line[] = [];
  if (split.sickDays > 0) {
    deductions.push({
      label: 'Sick leave',
      note: `${plural(split.sickDays, 'day')} · ${plural(detail.sickLeaveIds?.length ?? 0, 'request')}`,
      amount: split.sickDeduction,
    });
  }
  if (split.unpaidDays > 0) {
    deductions.push({
      label: 'Unpaid leave',
      note: `${plural(split.unpaidDays, 'day')} · ${plural(detail.unpaidLeaveIds?.length ?? 0, 'request')}`,
      amount: split.unpaidDeduction,
    });
  }
  y = drawSection(doc, 'Deductions', deductions, y, width, true);

  // Net band.
  doc.rect(PAGE_MARGIN, y, width, 54).fill(COLORS.band);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text).text('Net pay', PAGE_MARGIN + 12, y + 10);
  doc.fontSize(9).font('Helvetica').fillColor(COLORS.muted).text('Converted at the period exchange rate', PAGE_MARGIN + 12, y + 28);
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(COLORS.text)
    .text(formatIdr(data.totalIdr), PAGE_MARGIN, y + 8, { width: width - 12, align: 'right', lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(COLORS.muted)
    .text(formatUsd(data.totalUsd), PAGE_MARGIN, y + 30, { width: width - 12, align: 'right', lineBreak: false });
  y += 70;

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      `This payslip is computer-generated by the ${COMPANY.name} ${COMPANY.tagline} and is valid without a signature. ` +
        'Figures are a frozen snapshot of the finalized payroll period and will not change.',
      PAGE_MARGIN,
      y,
      { width },
    );

  drawFooters(doc, data.generatedAt);
  return documentToBuffer(doc);
}
