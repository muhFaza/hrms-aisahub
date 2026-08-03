# Payroll Cutoff Date Range Design

## Goal

Give every payroll month an explicit, HR-editable date range. A newly selected payroll
month defaults to the 26th of the previous month through the 25th of the selected month.
That stored range becomes the single source of truth for preview, finalization, payslip
calculation, exports, and finalized-period locking.

For example, August 2026 defaults to 26 July 2026 through 25 August 2026. January 2027
defaults to 26 December 2026 through 25 January 2027.

## User Experience

### Create period

The existing **New Payroll Period** modal keeps Year and Month and adds **Start Period** and
**End Period** immediately below Month. Both are date pickers and remain editable by HR.

Changing Year or Month resets the two date pickers to that month's 26–25 default. The Create
button submits all four values. The modal shows field-level validation if either date is
missing or Start Period is after End Period. An overlap reported by the server is shown as a
clear error and the modal remains open so HR can correct the dates.

### Draft period detail

The payroll-period detail page displays the stored date range. While the period is DRAFT,
HR can edit and save both dates together. Saving refreshes the live payroll preview because
the included employees and records may change. FINALIZED periods display the range as
read-only alongside the existing lock message.

Year and Month remain the period's label and uniqueness key. Editing the date range does not
rename the payroll month.

## Data Model and Migration

`PayrollPeriod` gains required `startDate` and `endDate` calendar-day fields stored as
PostgreSQL `date` values. Application serialization exposes them as `YYYY-MM-DD` strings.
All conversions use the project's UTC-midnight date convention.

The database enforces both invariants:

- `startDate <= endDate` through a CHECK constraint.
- No two payroll ranges overlap, including DRAFT periods, through an inclusive PostgreSQL
  date-range exclusion constraint.

All existing periods are backfilled with their original calendar-month boundaries, from the
first through the last day of their labeled month. This preserves historical payslip meaning,
the dates already locked by finalization, and the current preview of any existing DRAFT.
Automatically shifting an old DRAFT could overlap a neighboring historical period and count
the same record twice. HR can move a legacy DRAFT to a non-overlapping custom range from the
detail page after the migration. The 26–25 default applies to newly created periods.

The migration creates no payslips and does not alter any stored payslip snapshot.

## API and Validation

`POST /payroll/periods` accepts `year`, `month`, `startDate`, and `endDate`. The server also
derives the 26–25 default when dates are omitted so older callers cannot accidentally create
a calendar-month period after this change. Explicitly supplied dates must be supplied as a
pair.

The existing `PATCH /payroll/periods/:id` endpoint is extended instead of adding a parallel
route. It accepts the existing exchange-rate update or a `startDate`/`endDate` pair. Date
updates are rejected unless the period is DRAFT. Updating only one boundary is rejected so
the server always validates a complete range.

Validation and error behavior:

- malformed or incomplete dates: `400`;
- Start Period after End Period: `400`;
- a range overlapping any other payroll period: `409`;
- any attempt to edit a FINALIZED period: `409`.

The service performs the friendly pre-check for overlap, while the database exclusion
constraint is the final protection against two concurrent requests passing that check.

## Payroll Calculation

The payroll service stops reconstructing the period as the first and last calendar day from
Year and Month. It passes the stored start and end dates to all database queries and to the
database-free payroll calculation library.

The stored range controls:

- which employments overlap the period and therefore receive a payslip;
- approved overtime and reimbursements included in the run;
- part-time daily logs included in the run;
- overlapping leave days and holidays;
- attendance boundaries and counts;
- employment clipping and full-time proration.

A full-time employee employed for the complete custom range receives the existing full
monthly salary. If employment covers only part of the custom range, salary is prorated using
working days covered by employment divided by all working days in that custom range. Existing
payroll component formulas, rounding, the salary deduction cap, and exchange-rate behavior
remain unchanged.

Draft previews are recomputed against the current stored range on every read. FINALIZED
periods continue to return immutable Payslip snapshots.

## Finalized-Period Lock

`assertPeriodEditable(date)` finds a FINALIZED payroll period whose inclusive stored range
contains the record date. It no longer checks only the record's calendar Year and Month.

Finalizing August 2026 with 26 July–25 August therefore locks records dated 26 July through
25 August. Records dated 26–31 August remain editable until a later finalized period covers
them. The existing limitation that leave cancellation checks only the leave request's start
date is not expanded by this feature.

The lock error identifies the labeled payroll month and its stored range so HR can understand
why a date from the previous calendar month is closed.

## Exports and Notifications

The payroll-sheet PDF and payslip attendance detail display the stored Start Period and End
Period. Export filenames, period headings, the payroll list, payslip list, and notifications
continue to use the labeled Year and Month, such as August 2026.

The payout CSV format does not gain columns; its included amounts come from the already
finalized range-based snapshots.

## Files Expected to Change

- `server/prisma/schema.prisma` and one new migration: store and constrain both dates.
- `server/src/modules/payroll/schemas.ts`, `controller.ts`, and `service.ts`: accept, update,
  serialize, validate, and calculate using the range.
- `server/src/lib/payroll.ts` and `server/src/lib/periodLock.ts`: use explicit inclusive
  boundaries.
- `server/src/lib/pdf/payrollSheet.ts` and its input types: render the stored range.
- `client/src/api/payroll.ts`: expose dates and date-range mutation payloads.
- `client/src/pages/payroll/PayrollPage.tsx`: add defaulted editable date inputs.
- `client/src/pages/payroll/PayrollPeriodDetailPage.tsx`: show and edit the DRAFT range.
- Existing payroll, route, period-lock, PDF, and related mutation tests: cover the changed
  behavior after implementation.

No new production component or service file is planned because the existing payroll files
are the correct owners of this behavior.

## Implementation-First Verification

Following the repository workflow, implementation comes before new or updated tests. After
implementation, verification must cover:

- August 2026 defaults to 26 July–25 August;
- January crosses the year boundary correctly;
- HR can supply custom dates at creation;
- HR can update both dates on a DRAFT period and the preview changes;
- a FINALIZED period rejects date changes;
- reversed, incomplete, and overlapping ranges are rejected;
- concurrent overlapping writes are rejected by the database;
- overtime, reimbursement, daily logs, leave, holidays, employment overlap, attendance, and
  proration use the stored inclusive range;
- finalization locks dates inside the range and leaves dates outside it editable;
- PDFs display the stored range;
- legacy FINALIZED Payslip snapshots remain unchanged;
- the full server test suite, client/server build checks, and project lint command pass.

After local verification, separate subagents review the accumulated implementation for
runtime correctness and for code quality/security, as required by the repository workflow.
