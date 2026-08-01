import { periodKey } from '../pdf/theme';

// The payment-gateway upload file. Deliberately vendor-neutral rather than matching one
// gateway's template — the columns are the ones every mass-payout importer asks for.

export interface PayoutRow {
  employeeId: number;
  fullName: string;
  email: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  totalIdr: number;
  totalUsd: number;
}

export interface PayoutCsvResult {
  csv: string;
  included: number;
  excluded: number;
}

const HEADER = [
  'employee_id',
  'full_name',
  'email',
  'bank_name',
  'bank_account_number',
  'amount_idr',
  'amount_usd',
  'period',
  'reference',
];

// A leading =, +, - or @ makes Excel and Sheets treat the cell as a formula. Tab and carriage
// return are in the list because both are stripped before the formula check, so "\t=cmd" is
// still evaluated (OWASP CSV injection). full_name and bank_name are HR-entered free text and
// this file is going to be opened in a spreadsheet, so neutralise the cell with a leading
// apostrophe before quoting.
function neutralize(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

// Whether a row is worth sending to a gateway. Shared with the PDF sheet so the payable total
// printed there is computed by the same rule that decides what the CSV contains.
export function isPayable(row: { totalIdr: number }): boolean {
  return row.totalIdr > 0;
}

// RFC 4180: always quote, and double any embedded quote. Quoting unconditionally means a name
// containing a comma, a newline or a quote cannot shift the columns.
function escapeField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const text = typeof value === 'number' ? String(value) : neutralize(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Renders the payout file for one finalized period.
 *
 * Rows with a non-positive net are omitted: a part-timer who logged no hours, or someone whose
 * deductions exceeded their salary, produces a payout no gateway can action. They stay on the
 * PDF sheet, which is the record of what was computed — the caller surfaces `excluded` so the
 * omission is never silent.
 */
export function renderPayoutCsv(rows: PayoutRow[], year: number, month: number): PayoutCsvResult {
  const period = periodKey(year, month);
  const payable = rows.filter(isPayable);

  const lines = [HEADER.join(',')];
  for (const row of payable) {
    lines.push(
      [
        escapeField(row.employeeId),
        escapeField(row.fullName),
        escapeField(row.email),
        escapeField(row.bankName),
        escapeField(row.bankAccountNumber),
        escapeField(Math.round(row.totalIdr)),
        escapeField(row.totalUsd.toFixed(2)),
        escapeField(period),
        escapeField(`PAY-${period}-${row.employeeId}`),
      ].join(','),
    );
  }

  // CRLF per RFC 4180, with a trailing terminator — the shape importers are least surprised by.
  // No UTF-8 BOM: it would help Excel but breaks strict gateway parsers.
  return {
    csv: `${lines.join('\r\n')}\r\n`,
    included: payable.length,
    excluded: rows.length - payable.length,
  };
}
