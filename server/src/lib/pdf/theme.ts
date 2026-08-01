import PDFDocument from 'pdfkit';

// Shared look and helpers for the generated PDFs. Kept database-free like the rest of lib/,
// so both renderers are pure functions over plain data and unit-testable.

// One company, one deployment — this is a constant rather than a settings table or env vars.
export const COMPANY = {
  name: 'Aisahub Inc',
  address: 'Seoul, Republic of Korea',
  tagline: 'Human Resource Management System',
} as const;

export const PAGE_MARGIN = 40;

export const COLORS = {
  text: '#1f1f1f',
  muted: '#8c8c8c',
  rule: '#d9d9d9',
  band: '#fafafa',
  negative: '#cf1322',
} as const;

export type Doc = PDFKit.PDFDocument;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// e.g. (2026, 6) → "June 2026".
export function formatPeriod(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? '?'} ${year}`;
}

// e.g. (2026, 6) → "2026-06". The CSV period column and the payout reference.
export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Intl.NumberFormat('id-ID') is deliberately avoided: Node's ICU puts U+00A0 (and U+202F in
// some versions) inside the formatted string, which renders as a tofu box in a PDF standard
// font. Grouping by hand keeps the output to plain ASCII.
export function formatIdr(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp ${digits}`;
}

export function formatUsd(value: number): string {
  const sign = value < 0 ? '-' : '';
  const [whole, fraction] = Math.abs(value).toFixed(2).split('.');
  return `${sign}$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

// 'YYYY-MM-DD' → "01 Jun 2026". Parsed as UTC, since a calendar day is stored at UTC midnight
// and splitting it on a local-time boundary would shift it a day.
export function formatDateKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1].slice(0, 3)} ${year}`;
}

// The inclusive pay-period range, e.g. "01 Jun 2026 - 30 Jun 2026". A hyphen rather than an
// en dash: the PDF standard fonts are WinAnsi and this keeps the output plain ASCII.
export function formatDateRange(startKey: string, endKey: string): string {
  return `${formatDateKey(startKey)} - ${formatDateKey(endKey)}`;
}

// First and last calendar day of a payroll month, as date keys.
export function periodBounds(year: number, month: number): { start: string; end: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

// UTC so a timestamp reads the same wherever the PDF is opened, matching how the rest of the
// system treats dates.
export function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()].slice(0, 3)} ${date.getUTCFullYear()}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

export function createDocument(layout: 'portrait' | 'landscape'): Doc {
  return new PDFDocument({
    size: 'A4',
    layout,
    margin: PAGE_MARGIN,
    bufferPages: true, // page numbering needs the total, known only once drawing is done
    info: { Author: COMPANY.name, Creator: `${COMPANY.name} HRMS` },
  });
}

// Resolves once pdfkit has flushed every page. Callers await this instead of streaming to the
// response so an error mid-render still produces a clean 500 rather than a truncated body.
export function documentToBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// Company block plus document title. Returns the y to continue drawing from.
export function drawHeader(doc: Doc, title: string, subtitle: string): number {
  const right = doc.page.width - PAGE_MARGIN;

  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(16).text(COMPANY.name, PAGE_MARGIN, PAGE_MARGIN);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(COMPANY.address);

  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(COLORS.text)
    .text(title, PAGE_MARGIN, PAGE_MARGIN + 2, { width: right - PAGE_MARGIN, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(subtitle, { width: right - PAGE_MARGIN, align: 'right' });

  const y = Math.max(doc.y, PAGE_MARGIN + 46) + 8;
  doc.moveTo(PAGE_MARGIN, y).lineTo(right, y).strokeColor(COLORS.rule).lineWidth(1).stroke();
  doc.fillColor(COLORS.text);
  return y + 16;
}

// Footer on every buffered page. Must run after all content is drawn, since it needs the page
// count; pdfkit's bufferPages lets us go back and stamp them.
export function drawFooters(doc: Doc, generatedAt: Date): void {
  const range = doc.bufferedPageRange();
  // The footer sits inside the bottom margin by design, and pdfkit auto-adds a page for any
  // text that crosses that boundary — stamping N pages would otherwise emit 3N. Dropping the
  // bottom margin for the duration is the documented way to write into it.
  const bottomMargins = new Map<number, number>();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    bottomMargins.set(i, doc.page.margins.bottom);
    doc.page.margins.bottom = 0;
  }

  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - PAGE_MARGIN + 6;
    const right = doc.page.width - PAGE_MARGIN;
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
    doc.text(`Generated ${formatTimestamp(generatedAt)}`, PAGE_MARGIN, y, {
      width: right - PAGE_MARGIN,
      align: 'left',
      lineBreak: false,
    });
    doc.text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN, y, {
      width: right - PAGE_MARGIN,
      align: 'right',
      lineBreak: false,
    });
  }
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = bottomMargins.get(i) ?? PAGE_MARGIN;
  }

  // Leave the cursor on the last page; flushing mid-buffer otherwise appends a blank page.
  doc.switchToPage(range.start + range.count - 1);
}

// Label/value pair used by both documents' metadata blocks. Both lines are clipped rather than
// wrapped: these are drawn at absolute coordinates, so a long name or position would otherwise
// wrap down into whatever block is laid out beneath it.
export function drawField(doc: Doc, label: string, value: string, x: number, y: number, width: number): void {
  const clip = { width, lineBreak: false, ellipsis: true } as const;
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(label.toUpperCase(), x, y, clip);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(value, x, y + 11, clip);
}
