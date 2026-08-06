# Employment lifecycle: termination, contract-end reminders, rehire

Design record — 2026-08-02.

## Problem

The system has no concept of employment ending. `Employee.isActive` and `User.isActive` are
two unlinked booleans, neither of which means "this person left on this date":

- **`contractEndDate` is inert.** No code reads it. The date passes and the employee keeps
  their login, their full monthly salary and their leave accrual until HR remembers to flip
  a switch by hand.
- **There is no correct moment to flip it.** `computeRows` filters `isActive: true`, and
  draft periods are computed live. Deactivate before finalize and the final month pays
  zero; deactivate after and it pays in full. Partial months are inexpressible.
- **Deactivating the employee does not cut access.** `auth.ts` reads only `User.isActive`,
  and no submission path checks the employee at all — so a "deactivated" employee can still
  log in and file leave, overtime, reimbursements and daily logs.
- **Rehire retroactively grants leave.** `ensureAccrualsUpToDate` cursors from
  `fullTimeSince` and creates every missing month. Reactivating someone who left a year ago
  grants twelve leave days for time they were not employed.
- **Nothing is auditable.** A boolean records the current state only. Who ended the
  employment, when, and why are all unrecorded, and a rehire overwrites what little there
  was.

## Approach

Employment becomes a sequence of records rather than a flag. One row per continuous stretch
of employment; status, access and payroll eligibility all derive from it.

### `Employment`

Named `Employment`, not `EmploymentPeriod` — `PayrollPeriod`, `LeaveAccrual.period` and
`assertPeriodEditable` already own "period" in this codebase, and a second unrelated meaning
would be actively confusing.

| Column | Purpose |
| --- | --- |
| `employeeId` | FK, indexed |
| `startDate` | Join or rehire date for this engagement (UTC midnight) |
| `endDate` | Termination effective date; `NULL` = currently employed |
| `endReason` | Why it ended |
| `contractStartDate`, `contractEndDate` | Contract window **for this engagement** |
| `fullTimeSince` | Accrual anchor **for this engagement** |
| `leaveBalanceAtEnd` | Balance frozen at termination, for the record |
| `recordedById` | FK `User`, `ON DELETE SET NULL` — who recorded it |
| `createdAt`, `updatedAt` | |

A partial unique index on `(employeeId) WHERE endDate IS NULL` enforces **at most one open
employment per employee**. This is what makes "currently employed" unambiguous rather than a
convention.

### What moves, what stays

`contractStartDate`, `contractEndDate` and `fullTimeSince` move from `Employee` onto
`Employment`. Each engagement gets its own contract window and its own accrual anchor.

`Employee.joinDate` stays as the original first join, so tenure across engagements survives.
`Employee.isActive` is **dropped** — status derives from the open employment.

`LeaveAccrual` gains `employmentId`. Balance is the sum over the *current* employment, which
makes "reset on rehire" structural rather than a rule to remember, and makes the
gap-backfill bug unreachable.

### Derived status

```
ACTIVE     — an open employment exists, or its endDate is still in the future
TERMINATED — the latest employment has an endDate on or before today
```

A future-dated `endDate` is the notice-period case: the employee stays active until the day
arrives, then cuts off with nothing scheduled to flip them. Derivation lives in `lib/` as a
pure function over an employment record, keeping `lib/` database-free.

## Behaviour changes

**Auth.** `auth.ts` already re-reads the user row on every request; it also reads the linked
employee's current employment and returns 401 when terminated. One source of truth, and it
honours the standing invariant that authorization reads the database, not the token. HR
accounts have no employee link and are unaffected.

**Payroll.** An employee is included when an employment overlaps the month. Full-timers
prorate as:

```
salary × workedWorkingDays / actualWorkingDaysInMonth
```

where *worked* is the month's working days intersected with the employment. This never over-
or under-pays and needs no floor or cap. Terminate-and-rehire within one month sums both
segments, which falls out of the same intersection.

Part-timers need no proration — they are paid per logged hour, so their logs simply stop.

Accepted inconsistency: a day not worked because of termination is valued at
`salary / actualWorkingDays`, while a day of sick or unpaid leave is valued at `salary / 21`
via the hardcoded divisor in `lib/payroll.ts`. Unifying them would change the value of every
existing leave deduction, including in finalized months, so it stays out of scope.
`known-issues.md` already records the divisor as a rough edge.

**Accrual.** Cursors from `employment.fullTimeSince`, stops at `employment.endDate`, and
considers open employments only.

**Submissions.** Leave, overtime, reimbursements and daily logs reject a terminated
employee, closing the gap where a deactivated employee could still file.

**Leave at exit.** The remaining balance is frozen onto `leaveBalanceAtEnd` and forfeited. A
rehire starts a new employment at zero. Payout is deliberately not implemented: it would add
an earnings line to the payslip and both PDF exports, and needs a rule for expired-but-unused
days. The stamped balance leaves a manual payout possible outside the app.

## Contract-end reminders

There is no scheduler in this codebase — no cron, no `setInterval`, no queue. The
established pattern for time-based work is `ensureAccrualsUpToDate`: idempotent, works out
what should exist by now, creates only what is missing, called at boot and on the read paths
that need freshness.

`ensureContractRemindersUpToDate()` follows it exactly. It finds open employments whose
`contractEndDate` falls within the lead window and which have no unresolved reminder, then
`emitToHr`. Called at boot and when HR fetches notifications.

- **Lead time:** 30 days.
- **Repeat:** one reminder per `(employment, contractEndDate)`, so extending the contract
  re-arms it.
- **Resolution:** stays unresolved until HR renews the contract or terminates.

Requires a new `NotificationType.CONTRACT_ENDING` and an `EMPLOYMENT` entity type.

Tradeoff accepted: if nobody opens the app for a week, the reminder appears when they next
do rather than on the day it was due. For a 30-day-ahead warning this is immaterial, and it
avoids adding infrastructure to a 1GB VPS.

## HR workflow

- **Terminate** — date defaults to `contractEndDate` when set, otherwise today, and is
  overridable including future-dated. Reason required. This covers termination earlier or
  later than contract end.
- **Rehire** — available on a terminated employee; opens a new employment with its own
  contract dates and accrual anchor.
- **Employment history** — listed on the employee detail page, each row showing dates,
  reason, forfeited balance and who recorded it.
- **Employees list** — status column and Active/Terminated filter, both derived.

## Migration

Single migration, and the most carefully reviewed part of the change.

1. Create `Employment`.
2. Backfill one row per employee: `startDate` from `joinDate`, contract dates and
   `fullTimeSince` copied across, `endDate` NULL where `isActive` is true.
3. Add `LeaveAccrual.employmentId` and point every existing accrual at the backfilled row.
4. Drop `Employee.isActive`, `contractStartDate`, `contractEndDate`, `fullTimeSince`.

**Open item.** Employees currently at `isActive = false` have no recorded termination date.
Proposal: set `endDate` from `updatedAt` as the best available signal, with
`endReason = 'BACKFILL_UNKNOWN'`. If production has no inactive employees, the question is
moot — **verify before writing the migration.**

This drops columns on live payroll data. There are no automated backups; a `pg_dump`
immediately before deploy is required, and it carries the whole rollback burden, since
Prisma has no down-migrations and a code rollback would leave the schema migrated.

## Testing

- `lib/` unit tests: proration arithmetic across month lengths, status derivation including
  the future-dated boundary.
- Service tests: terminate, rehire, accrual scoped to an employment, balance frozen at exit.
- Route tests: a terminated employee gets 401; terminate and rehire are HR-only. Per the
  repo's testing note, rejections assert stored state rather than status codes alone.
- Payroll tests: final month prorated; a full final month pays in full; terminate-and-rehire
  inside one month sums both segments; finalized months are untouched.

## Out of scope

- Leave payout at termination (`kompensasi cuti`).
- Unifying the `/21` divisor with actual working days.
- Severance or THR calculation — `thrEligible` remains a flag with no rule behind it.
- Login rate limiting, the login timing oracle and `queryClient.clear()` on logout, all
  deferred from the previous batch and still open.
