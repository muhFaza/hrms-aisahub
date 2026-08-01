import { describe, expect, it } from 'vitest';
import { renderPayoutCsv, type PayoutRow } from '../csv/payoutCsv';

function row(overrides: Partial<PayoutRow> = {}): PayoutRow {
  return {
    employeeId: 3,
    fullName: 'Rina Kartika',
    email: 'rina@example.test',
    bankName: 'BCA',
    bankAccountNumber: '1234567890',
    totalIdr: 12_500_000,
    totalUsd: 780.25,
    ...overrides,
  };
}

function lines(csv: string): string[] {
  return csv.trimEnd().split('\r\n');
}

describe('payout CSV — shape', () => {
  it('emits the agreed header in order', () => {
    const { csv } = renderPayoutCsv([], 2026, 6);
    expect(lines(csv)[0]).toBe(
      'employee_id,full_name,email,bank_name,bank_account_number,amount_idr,amount_usd,period,reference',
    );
  });

  it('renders a row with a zero-padded period and a derived reference', () => {
    const { csv } = renderPayoutCsv([row()], 2026, 6);
    expect(lines(csv)[1]).toBe(
      '"3","Rina Kartika","rina@example.test","BCA","1234567890","12500000","780.25","2026-06","PAY-2026-06-3"',
    );
  });

  it('terminates every line with CRLF, including the last', () => {
    const { csv } = renderPayoutCsv([row()], 2026, 6);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3); // header, row, trailing empty
  });

  it('emits no byte-order mark', () => {
    const { csv } = renderPayoutCsv([row()], 2026, 6);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('always pads the USD amount to two decimals', () => {
    const { csv } = renderPayoutCsv([row({ totalUsd: 780 })], 2026, 6);
    expect(lines(csv)[1]).toContain('"780.00"');
  });

  it('writes an empty field for a missing bank account rather than "null"', () => {
    const { csv } = renderPayoutCsv([row({ bankName: null, bankAccountNumber: null, email: null })], 2026, 6);
    expect(lines(csv)[1]).toBe('"3","Rina Kartika","","","","12500000","780.25","2026-06","PAY-2026-06-3"');
  });
});

describe('payout CSV — escaping', () => {
  it('doubles an embedded quote instead of breaking the field', () => {
    const { csv } = renderPayoutCsv([row({ fullName: 'Rina "Kiki" Kartika' })], 2026, 6);
    expect(lines(csv)[1]).toContain('"Rina ""Kiki"" Kartika"');
  });

  it('keeps a name containing a comma in one column', () => {
    const { csv } = renderPayoutCsv([row({ fullName: 'Kartika, Rina' })], 2026, 6);
    const fields = lines(csv)[1].match(/"(?:[^"]|"")*"/g);
    expect(fields).toHaveLength(9);
    expect(fields?.[1]).toBe('"Kartika, Rina"');
  });

  // Tab and CR are included because a spreadsheet strips them before deciding whether the cell
  // is a formula, so "\t=cmd" still evaluates.
  it.each(['=cmd|calc', '+1234', '-2+3', '@SUM(A1)', '\t=cmd|calc', '\r=cmd|calc'])(
    'neutralizes the spreadsheet formula %s with a leading apostrophe',
    (name) => {
      const { csv } = renderPayoutCsv([row({ fullName: name })], 2026, 6);
      expect(lines(csv)[1]).toContain(`"'${name}"`);
    },
  );

  it('leaves an ordinary name untouched', () => {
    const { csv } = renderPayoutCsv([row({ fullName: 'Budi Santoso' })], 2026, 6);
    expect(lines(csv)[1]).toContain('"Budi Santoso"');
    expect(lines(csv)[1]).not.toContain("'Budi");
  });
});

describe('payout CSV — non-payable rows', () => {
  it('omits a zero net and reports it as excluded', () => {
    const result = renderPayoutCsv(
      [row({ employeeId: 1 }), row({ employeeId: 2, totalIdr: 0, totalUsd: 0 })],
      2026,
      6,
    );
    expect(result.included).toBe(1);
    expect(result.excluded).toBe(1);
    expect(lines(result.csv)).toHaveLength(2);
    expect(result.csv).not.toContain('PAY-2026-06-2');
  });

  it('omits a negative net — deductions can exceed salary', () => {
    const result = renderPayoutCsv([row({ totalIdr: -50_000, totalUsd: -3.13 })], 2026, 6);
    expect(result.included).toBe(0);
    expect(result.excluded).toBe(1);
    expect(lines(result.csv)).toHaveLength(1);
  });

  it('counts nothing as excluded when every row is payable', () => {
    const result = renderPayoutCsv([row({ employeeId: 1 }), row({ employeeId: 2 })], 2026, 6);
    expect(result).toMatchObject({ included: 2, excluded: 0 });
  });
});
