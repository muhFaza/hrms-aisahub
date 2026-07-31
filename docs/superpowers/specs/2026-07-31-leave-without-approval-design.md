# Leave without approval — design

**Date:** 2026-07-31
**Branch:** `feat/leave-no-approval`
**Status:** approved, pending implementation plan

## Summary

A leave request stops being a *request* and becomes a *record*. There is no HR approval
or rejection step: an employee submits leave, and it takes effect immediately — paid-leave
balance is consumed at submit time, and the leave shows up in the calendar, dashboard and
payroll straight away.

To keep the human coordination that approval used to force, the client shows a
confirmation step before submitting, reminding the employee to notify their team and get
their project manager's sign-off first.

Overtime, reimbursements and daily logs keep their approval flows unchanged. This design
touches leave only.

## Motivation

HR approval was never where the real decision happened. Whether someone can take leave on
a given week is a team and project-manager call, made in standup and chat, and HR clicking
Approve afterwards added a queue without adding a check. Removing it deletes a step that
only ever rubber-stamped, and replaces it with a prompt at the point where the employee
can actually still act on it.

## Non-goals

- Changing the approval flow for overtime, reimbursements or daily logs.
- Recording or verifying the project manager's approval. The confirmation checkbox is a
  nudge, not an audit trail — see "Rejected alternatives".
- Changing accrual, expiry or payroll arithmetic. Only the *timing* of paid-leave
  consumption moves.

---

## 1. Data model

`LeaveRequest` loses four columns:

| Column | Fate |
| --- | --- |
| `status` (`RequestStatus`) | dropped |
| `reviewedById` (`Int?`, FK → `User`) | dropped |
| `reviewedAt` (`DateTime?`) | dropped |
| `rejectReason` (`String?`) | dropped |

The `reviewedLeaveRequests LeaveRequest[] @relation("LeaveReviewer")` back-relation comes
off `User`.

**The `RequestStatus` enum stays.** `Overtime` and `Reimbursement` still use it.
(`DailyLog` never had a status.)

**Knock-on:** `reviewedById` was one of the five `ON DELETE SET NULL` foreign keys that
the "Deleting a User" section of `CLAUDE.md` warns about. After this change there are
four. That section must be updated, not just left to drift — it is safety documentation
for a destructive operation.

## 2. Migration — `remove_leave_approval`

One transaction, four steps, in this order. Steps 1–2 must run *before* the columns are
dropped, since they read `status`.

### Step 0 — Lock out concurrent writers

*Added during implementation review.* `LOCK TABLE "LeaveRequest", "LeaveAccrual" IN
EXCLUSIVE MODE;` as the first statement. During a rolling deploy the old container is still
serving, and without this it can insert a PENDING PAID request between the step 1 guard and
the step 2 consumption — leaving a row that survives as taken leave which never consumed
balance. EXCLUSIVE blocks writers (and the row lock `submitLeave` now takes) while still
allowing plain reads.

### Step 1 — Guard

Raise an exception if any employee's total pending PAID days exceed their non-expired
available balance (`SUM(days - daysConsumed)` over rows with `expiresAt > now()`).

This aborts the migration rather than silently under-consuming and leaving the balance
overstated. A pending request that can't be paid for is a data problem a human must look
at, not something a migration should paper over.

### Step 2 — Retroactive FIFO consumption

For every `status = 'PENDING' AND type = 'PAID'` request, consume `totalDays` across that
employee's non-expired `LeaveAccrual` rows, ordered by `expiresAt ASC, period ASC` —
the same FIFO order `planFifoAllocation` uses at runtime.

Implemented as a single `UPDATE` with a window-function running total: for each accrual
row, the amount taken is
`LEAST(available, GREATEST(need - prior_running_total, 0))`.
The `LEAST` keeps the existing `daysConsumed <= days` CHECK constraint safe by
construction.

Requests are aggregated per employee (`SUM(totalDays) GROUP BY employeeId`) — an employee
with two pending requests must consume for both.

> **Verification:** production holds exactly one `PENDING`/`PAID` request. Before the
> deploy, compute the expected post-migration `daysConsumed` for that employee by hand
> from the live accrual rows and assert the migration produces it.

### Step 3 — Delete rejected rows

`DELETE FROM "LeaveRequest" WHERE status = 'REJECTED';`

Zero rows in production, but development databases and any future environment need it —
a rejected row with no status column is indistinguishable from taken leave, which would
silently invent leave that never happened.

### Step 4 — Drop columns

Drop the FK constraint on `reviewedById`, then the four columns.

### Reversibility

There is no down migration; dropping `status` destroys the taken/rejected distinction
irrecoverably. Recovery is the database backup. **Take a fresh `pg_dump` on the VPS
immediately before this migration deploys.** Production exposure is 2 leave rows.

## 3. Server changes

### `modules/leave/service.ts`

**`submitLeave` — now a transaction.** The overlap check, the balance check,
`consumePaidLeave` and the `create` all move inside one `prisma.$transaction`. This is the
correctness-critical part of the change: with approval gone, the balance guard and the
consumption that depends on it can no longer be separated by an approval step, so they
must not be separated by a transaction boundary either. `consumePaidLeave` keeps its
existing conditional-increment TOCTOU guard.

The overlap check drops `status: { in: ['PENDING', 'APPROVED'] }` — it now matches *any*
overlapping request, because every stored request is real leave.

*Added during implementation review:* the transaction opens with
`SELECT id FROM "Employee" WHERE id = $1 FOR UPDATE`, serializing one employee's
submissions. Under READ COMMITTED two concurrent submissions for overlapping dates would
otherwise both read "no overlap" and both insert, and there is no exclusion constraint to
catch it. This pre-dates the change, but it matters more now that a submission takes effect
and spends balance immediately. It is defence in depth — the conditional increment in
`consumePaidLeave` and the CHECK constraint stay.

**`reviewLeave` — deleted**, along with the `sendLeaveDecisionEmail` call.

**`cancelLeave` — reworked.** Cancelling now undoes real leave, so it must refund:

- Drops the `status !== 'PENDING'` check.
- Keeps `assertPeriodEditable(request.startDate)` — *moved inside the transaction during
  implementation review*, reading through `tx`, so payroll cannot finalize the month between
  the check and the refund it guards. `lib/periodLock.ts` takes an optional client parameter
  defaulting to the global one; no other caller changes.
- **New date-window rule:** an employee may cancel only while
  `toUtcDate(new Date()) <= request.startDate` — that is, up to and including the leave's
  first day. Once the start date has passed, the leave is taken and can't be withdrawn.
  Rejected with `HttpError(400, ...)`.
- **HR is exempt from the date window** and may cancel a past-dated leave as an override
  correction. HR is **not** exempt from `assertPeriodEditable`: unwinding leave inside a
  finalized payroll month would contradict already-issued payslips, and "a finalized
  payroll month is frozen" is a standing invariant.
- **New `refundPaidLeave`,** for `type === 'PAID'` only: decrements `daysConsumed` across
  the employee's accrual rows, **non-expired rows first in FIFO order** (`expiresAt ASC,
  period ASC`), **then expired rows in the same order**. Runs in the same transaction as
  the delete. Clamped at `daysConsumed >= 0`.

  Prisma cannot express that conditional ordering in one `orderBy`, so the rows with
  `daysConsumed > 0` are fetched and partitioned in JS on `expiresAt > now`.

  *Revised during implementation review.* This originally said **reverse FIFO**
  (`expiresAt DESC, period DESC`), reasoning that a leave drew from the newest rows last.
  That is wrong once a second leave has spilled over. With accruals A (expires Aug) and B
  (expires Dec): leave L1 taking 3 drains A; L2 taking 3 more fills A and puts 1 in B.
  Cancelling L1 under reverse FIFO refunds B's day first, ending A=3, B=0 — but L1 only
  ever drew from A, so the correct result is A=2, B=1. A day migrated from the
  soon-expiring row to the long-lived one, manufacturing usable future balance: exactly
  what the asymmetry note below exists to prevent. Plain ascending is also wrong — the
  query has no expiry filter, so it would refund into an expired row ahead of live ones.

  *Known asymmetry (unchanged):* if an accrual expired between the leave being taken and
  cancelled, the refund can land on a row that can no longer be spent, so the employee does
  not get those days back. Expired rows are now reached only after every live row has been
  refunded, so they absorb a remainder rather than taking priority. It remains deliberate:
  crediting a *live* row instead would silently extend an expiry date and manufacture
  balance — worse on a payroll system than losing days that were already going to expire.
  The cancel-before-start rule keeps the window small: it requires leave booked far enough
  ahead that an accrual expires before the leave begins.

  Nothing records which accrual rows a given leave drew from, so any refund is a
  reconstruction, not a replay. This ordering is chosen because it never invents spendable
  days.

**`getCalendar`** drops its `status: 'APPROVED'` filter.

### Other server files

| File | Change |
| --- | --- |
| `modules/leave/routes.ts` | Remove `PATCH /:id/review`. |
| `modules/leave/controller.ts` | Remove `review`. |
| `modules/leave/schemas.ts` | Remove `reviewLeaveSchema` / `ReviewLeaveInput`; remove `status` from `listLeaveQuerySchema`. |
| `lib/payroll.ts` | `SickLeaveRecord` loses `status`; `sickDaysInPeriod` drops its `leave.status !== 'APPROVED'` guard. |
| `lib/accrual.ts` | `sickTaken` aggregate drops `status: 'APPROVED'`. |
| `modules/payroll/service.ts` | Sick-leave gather query drops `status: 'APPROVED'`. |
| `modules/dashboard/service.ts` | `onLeaveToday` and `leaveThisMonth` drop the status filter. **`pendingLeave` removed from both the HR and employee stat blocks** — nothing is pending any more. `pending` keeps overtime and reimbursements. |
| `lib/email.ts` | `sendLeaveDecisionEmail` and its HTML template deleted. `sendLeaveSubmittedEmail` **stays** — with no approval queue, it becomes HR's primary signal that leave was taken. |
| `prisma/seed.ts` | Leave rows stop setting `status` / reviewer fields. |

`lib/` stays database-free throughout — `payroll.ts` and `accrual.ts` changes are type and
filter edits only.

## 4. Client changes

### `pages/leave/RequestLeaveModal.tsx` — two-step submit

Submitting the form opens a second confirmation modal instead of calling the API:

```
┌─ Before you submit ───────────────────┐
│ Paid Leave · 12–14 Aug 2026 · 3 days  │
│                                       │
│ Leave is recorded immediately — there │
│ is no HR approval step.               │
│                                       │
│ [x] I have notified my team and       │
│     obtained approval from my         │
│     project manager.                  │
│                                       │
│            [ Back ]  [ Submit Leave ] │
└───────────────────────────────────────┘
```

- Shows leave type, the date range, and the working-day count.
- **Submit Leave** is disabled until the checkbox is ticked.
- The checkbox resets every time the confirmation opens — it must never come up
  pre-ticked, or the friction it exists to create disappears.
- **Back** returns to the form with values intact.
- The working-day count shown is a client-side estimate; the server's
  `countWorkingDays` remains authoritative.

No API contract change.

### Other client files

| File | Change |
| --- | --- |
| `pages/leave/LeaveReviewPage.tsx` | Becomes an **All Leave** list: same table, same filters, minus the approve/reject buttons and the reject-reason modal. The actions column **stays**, reduced to a single Cancel action — this is where HR performs the override cancel, including on past-dated leave, so it must not be shown only for future leave. Confirmation warns that cancelling refunds paid-leave balance. Page title and nav label updated. |
| `pages/leave/MyLeavePage.tsx` | Drops the status column/tag. Cancel action shown only while the leave hasn't started. |
| `components/LeaveCalendar.tsx` | Drops status handling. |
| `pages/DashboardPage.tsx` | Drops the pending-leave tile. |
| `api/leave.ts` | Removes `LeaveStatus`, the status colour map, `useReviewLeave`, and `status` from the list query params. |

## 5. Tests

Remove all review coverage from `leave.service.test.ts` and `leave.routes.test.ts`, and
update `__tests__/helpers/factories.ts`.

New cases, following the handbook's rules — any HR-only capability needs a route test, and
rejections assert **stored state**, not just the status code:

1. Submitting PAID leave consumes balance immediately; `GET /leave/balance` reflects it on
   the next call.
2. A submit that would overdraw is rejected **and leaves `daysConsumed` unchanged** — the
   transaction rolled back rather than half-applied.
3. Cancelling PAID leave refunds exactly the days it consumed; balance returns to its
   pre-submit value.
4. Cancelling SICK leave refunds nothing and touches no accrual row.
5. An employee cancelling their own leave on its start date succeeds; the day after, it is
   rejected with 400 and the row still exists.
6. HR cancelling a past-dated leave succeeds (the override).
7. HR cancelling inside a finalized period is still blocked by `assertPeriodEditable`.
8. `PATCH /leave/:id/review` returns 404 — the route is gone.
9. An employee still cannot cancel another employee's leave (403).
10. Payroll deducts sick days for a leave record with no status column.

Per the project's standing rule, tests are written *after* the implementation and proposed
for review before running.

## 6. Documentation

| File | Change |
| --- | --- |
| `CLAUDE.md` | "Deleting a User": five FKs → four; drop the leave reviewer from the list. |
| `handbook/domain-rules.md` | Rewrite the leave lifecycle: no approval, consumption at submit, cancel window and refund. |
| `handbook/api-reference.md` | Remove `PATCH /leave/:id/review`; update `DELETE /leave/:id` rules; drop the `status` list filter. |
| `handbook/data-model.md` | Update the `LeaveRequest` model and the `RequestStatus` usage list. |
| `handbook/known-issues.md` | Record the refund/expiry asymmetry as a known, accepted behaviour. |

## Rejected alternatives

**Keeping `status` and defaulting everything to `APPROVED`.** Smaller migration, no
downstream query changes. Rejected because it leaves the schema asserting an approval
workflow that no longer exists — the next person to read the model would design against a
fiction, and the dead `reviewedById` FK would keep its silent-audit-trail-destruction
hazard on user deletion for no benefit.

**Recording the acknowledgement server-side** (an `acknowledgedAt` column, or a required
`acknowledged: true` field). Rejected as false assurance: it proves a checkbox was ticked,
not that a project manager agreed. The real approval lives in Slack and standup. Adding a
column and a required API field to store a self-reported boolean buys audit *appearance*
without audit *value*.

**An optional "approved by" free-text field.** Genuine audit value, but unverified free
text, and beyond the requested scope. Worth revisiting if HR later needs to trace
who signed off.

**No cancellation at all.** Simplest code — no refund logic, no date window. Rejected as
operationally hostile: a typo'd date range would need a DBA.
