# Payroll & payslip exports — design

**Date:** 2026-08-01
**Branch:** `feat/payroll-exports`

Two documents, generated server-side from data that is already frozen:

- **Payroll sheet (PDF) + payout file (CSV)** — HR, one pair per finalized period. The PDF is
  the archival/approval record; the CSV is what gets uploaded to a payment gateway.
- **Payslip (PDF)** — one per employee per finalized period. Employees download their own; HR
  can download anyone's.

## Why server-side

`pdfkit`, not headless Chrome. The production VPS has ~200–300MB RAM free and has OOM-killed
Node processes before; Puppeteer is not viable there. pdfkit is pure JS, streams, has no
native dependencies, and its built-in Helvetica covers every character in Indonesian names.

Server-side also means the numbers come straight off the frozen `Payslip` snapshot and are
never re-derived in a browser, and the endpoints are testable in the existing vitest suite.

Rupiah is formatted by a small manual helper rather than `Intl.NumberFormat('id-ID')` —
Node's ICU emits U+00A0 / U+202F inside the formatted string, which renders as tofu in a
PDF standard font.

## Module layout

`lib/` stays database-free, so renderers are pure functions over plain data:

| File | Responsibility |
| --- | --- |
| `server/src/lib/pdf/theme.ts` | `COMPANY` constant, page geometry, colors, money/date/period helpers, shared header & footer |
| `server/src/lib/pdf/payrollSheet.ts` | `renderPayrollSheet(data) => Buffer` — landscape A4 |
| `server/src/lib/pdf/payslip.ts` | `renderPayslip(data) => Buffer` — portrait A4 |
| `server/src/lib/csv/payoutCsv.ts` | `renderPayoutCsv(rows) => string` — RFC4180 + formula-injection guard |

`modules/payroll/service.ts` gains three functions that fetch, enforce the rules, call a
renderer, and return `{ filename, contentType, body }`. The controller only sets headers and
sends. Business rules stay in the service, per the repo invariant.

Company identity is a hardcoded `COMPANY` constant — one company, one deployment. No schema,
no settings UI, no new required env vars.

### Shared sick/unpaid split

`PayslipBreakdown.tsx:29-31` derives per-type leave money from the combined, once-rounded
`leaveDeduction`: sick is computed from `dailyRate` and unpaid takes the remainder, so the two
lines always sum to the stored total. The payslip PDF needs the identical split.

This is extracted as `splitLeaveDeduction()` in `server/src/lib/payroll.ts` and unit-tested
there. The client copy stays where it is — the wire boundary makes literal sharing impossible
— with a comment pointing at the server helper as the pinned definition.

## Endpoints

| Route | Role | Guard |
| --- | --- | --- |
| `GET /payroll/periods/:id/export/pdf` | HR | 404 unknown period; 409 unless `FINALIZED` |
| `GET /payroll/periods/:id/export/csv` | HR | 404 unknown period; 409 unless `FINALIZED` |
| `GET /payroll/payslips/:id/export/pdf` | any authenticated | own payslip, or HR; else 404 |

Path segments, not `.pdf` / `.csv` extensions, to stay clear of path-to-regexp parsing.

Registered after `/my-payslips` and alongside the existing `/periods/:id` routes; the
`/payslips/` prefix is distinct so no static-before-parameterized conflict arises.

A non-HR user requesting someone else's payslip gets **404, not 403**. A 403 confirms the
payslip exists, which turns the endpoint into a headcount oracle.

### Client download path

Auth is a bearer header, not a cookie, so a plain `<a href download>` would hit these
endpoints unauthenticated. Downloads go through the existing `apiClient` with
`responseType: 'blob'`, then an object-URL click, in one shared `client/src/lib/download.ts`.

## Document contents

### Payroll sheet — landscape A4

Company header. Period, status, finalized-at and finalized-by, exchange rate with its
`rateSource`. One row per payslip: Employee / Type / Basic / Overtime / Reimbursement /
Deduction / Net IDR / Net USD. Totals row. `Page N of M` and a generated-at footer.

### Payout CSV

```
employee_id,full_name,email,bank_name,bank_account_number,amount_idr,amount_usd,period,reference
```

`reference` is `PAY-<YYYY>-<MM>-<employeeId>`.

Every field is RFC4180-quoted. Any value beginning `=`, `+`, `-` or `@` is prefixed with `'`:
`full_name` and `bank_name` are HR-entered free text and this file will be opened in Excel.

No UTF-8 BOM. It would help Excel but breaks strict gateway parsers, and the data is Latin.

**Non-positive nets are omitted from the CSV** — a part-timer who logged no hours, or someone
whose deductions exceeded salary, produces a payout a gateway cannot action. They remain on
the PDF sheet, which is the record of what was computed. The export response carries
`X-Export-Included` / `X-Export-Excluded` headers so the UI can report
"12 of 14 employees — 2 excluded, nothing payable" and the omission is never silent.

### Payslip — portrait A4

Company header. Employee full name, position, employment type, period. Then the same lines
`PayslipBreakdown` shows, grouped into earnings and deductions, ending in Net IDR and Net USD
with the exchange rate. Footer: computer-generated, no signature required.

**No bank account and no KTP.** The employee gains nothing from either, and a downloaded PDF
is a forwarding/leak path.

Payslips finalized before unpaid leave existed have no `unpaidDays` in their stored detail and
get the same `?? 0` treatment the client already applies.

## Testing

**Unit** — CSV quoting, injection guard, column order, non-positive exclusion;
`splitLeaveDeduction` rounding including the legacy-detail case; PDF smoke tests asserting a
valid `%PDF-` buffer and no throw for full-time, part-time, legacy-detail and empty-period
inputs.

**Route** — required, these are new HR-only capabilities:

- HR 200 + correct content-type on a finalized period, PDF and CSV
- HR 409 on a draft period, both formats
- EMPLOYEE 403 on both period exports
- unauthenticated 401 on all three
- employee 200 on own payslip, 404 on another employee's
- HR 200 on any employee's payslip

## Out of scope

Bulk "all payslips as one zip", emailed payslips (there is no email in this system),
draft-period preview exports, and any per-deployment branding configuration.
