# Domain rules

The HR policy this system actually encodes. Where the code and the thesis design document
disagree, **the code is described here** and the disagreement is recorded at the bottom.

This is the most important page in the handbook. Everything else is mechanics; this is the
behaviour people will argue about.

---

## Leave

### Leave is full-time only

**Part-time employees cannot submit leave of any kind.** They are paid per logged hour, so a
day they do not log is already unpaid and there is nothing to record. The guard is in
`submitLeave` and covers every type.

`cancelLeave` is deliberately **not** gated this way. Leave history survives an employee
converting to part-time, and HR must still be able to unwind such a record.

Historical part-time leave records are never deleted. They are audit trail, they produce no
payroll effect, and — since nothing in the schema records employment-type history — there is
no way to tell a part-timer's own record from one earned while they were full-time.

### Types

Three: `PAID`, `SICK` and `UNPAID`. There is no maternity or bereavement category.

| | Consumes balance | Refunds on cancel | Payroll effect |
| --- | --- | --- | --- |
| `PAID` | Yes, FIFO | Yes | None |
| `SICK` | No | No | Deduction |
| `UNPAID` | No | No | Deduction |

`SICK` and `UNPAID` are mechanically identical — same deduction, same absence of balance
interaction. They differ only in what they record about *why* the day was taken, which is
what makes the payslip breakdown worth splitting.

Every balance, accrual and refund branch in the leave service keys on `type === 'PAID'`, so
`UNPAID` needs no special-casing: it falls through exactly as `SICK` does.

### How paid leave is earned

Not an annual grant. **One day per month, expiring 18 months after the month it was earned**,
stored as one row per employee per month.

Accrual rows are generated only for employees who are **full-time, active, and have a
`fullTimeSince` anchor**. The generator runs at server boot (non-blocking), and on demand
before any balance read or paid leave submission. There is no cron job.

The catch-up loop runs from the **start of the `fullTimeSince` month** through the **start of
the current month**, inclusive at both ends. Three consequences follow:

- Someone hired on the 30th receives a full day that same day.
- The current, incomplete month has already granted its day.
- Someone converted to full-time mid-month receives that month's day.

The first two contradict the "per completed month of service" wording in the design document,
the schema comment, and the code's own comment — but it is the tested, pinned behaviour.

### The accrual anchor — `Employment.fullTimeSince`

Accrual runs from `fullTimeSince`, **not `joinDate`** and not the employment's `startDate`.
`joinDate` remains the original hire date and is never touched by this.

The anchor lives on `Employment`, and the catch-up considers **open employments only**. That
is what stops a rehire walking the cursor back across the gap: before `Employment` existed,
reactivating someone who had left a year ago granted them a leave day for every month they
had been away.

Before the anchor existed, the catch-up ran from `joinDate`, so a part-timer later promoted to
full-time was granted a retroactive paid day for **every month they had been part-time**.

| Transition | `fullTimeSince` becomes |
| --- | --- |
| Created full-time | `joinDate` |
| Created part-time | `null` |
| PART_TIME → FULL_TIME | today, at UTC midnight |
| FULL_TIME → PART_TIME | `null` |
| Update not changing employment type | preserved |

HR may supply `fullTimeSince` explicitly on the employee form, which overrides the derived
value. That is the correction path for a conversion recorded late — without it, a conversion
effective 1 July but entered in August silently costs the employee July's day. A part-timer
never carries an anchor regardless of what the request body says.

Converting an employee twice overwrites the anchor with the later date. Rows earned in the
earlier full-time stint already exist and are skipped by the generator's existing-keys check,
so they survive; the part-time gap months are correctly never generated.

**A leave balance cannot be monetized or transferred.** Converting someone to part-time
therefore strands whatever balance they hold — it simply becomes unusable. There is no payout
to settle and no conversion guard. The employee form warns HR, showing the day count, before
the change is saved.

### Balance

```
balance      = Σ (days − daysConsumed) over rows that have NOT expired
accruedTotal = usedTotal + expiredTotal + balance     ← always holds
```

A row expires when `expiresAt <= now` — *at* the instant, not after. `expiredTotal` counts
only the **unused remainder** of expired rows.

"Expiring soon" means an unexpired row with days remaining that expires within 60 days.

`sickTaken` and `unpaidTaken` are **lifetime** totals, not per-year, and are independent of
each other. `PAID` leave counts toward neither.

### FIFO consumption

When paid leave is **submitted**, days are drawn **oldest-expiring first** — ordered by
`expiresAt`, not by row id and not by `period`. That distinction is deliberate and
explicitly tested.

Rows already fully consumed are skipped. Fractional draws are supported. Expired rows are
excluded from the query entirely, so **expired days are unreachable — they cannot be
spent, and there is no way to reclaim them.**

If the available rows cannot cover the request, submission is rejected with
*"Insufficient leave balance: requested N day(s) but only M available"* and nothing is
written. The balance check and the consumption run in **one transaction**, so a rejected
submission can never leave the accrual half-spent.

**Concurrency:** each decrement is a conditional update guarded on the row not having been
spent underneath it. A lost race returns 409 *"Leave balance changed, please retry"*. A
database CHECK constraint is the final backstop.

### Refund on cancellation

Cancelling PAID leave gives the days back, **non-expired rows first in FIFO order**
(`expiresAt` ASC, `period` ASC), **then expired rows** in the same order. The refund runs in
the same transaction as the delete. SICK and UNPAID leave refund nothing, because they
consumed nothing.

Nothing records which accrual rows a given leave drew from, so this is a reconstruction, not
a replay. It is ordered this way because it never moves a day from a soon-expiring row to a
longer-lived one — refunding newest-first would do exactly that whenever a later leave had
spilled over, manufacturing spendable future balance.

Expired rows can still receive a refund, but only once every live row has been refunded. If
an accrual expired between the leave being taken and cancelled, days landing there can no
longer be spent and are lost. That is deliberate: crediting a live row instead would
silently extend an expiry date. See [known-issues.md](known-issues.md).

### Counting days

`totalDays` is the working days in the range, **inclusive of both endpoints**, excluding
Saturdays, Sundays, and any **off-day** holiday. All arithmetic is UTC.

Off-day means `NATIONAL`, `COMPANY` or `SPECIAL`. `JOINT_LEAVE` is *not* an off day — see
[Holidays](#holidays) — so leave taken across a cuti bersama does consume that day.

A holiday that falls on a weekend does not subtract twice. A range containing zero working
days is rejected.

### The lifecycle

**There is no approval step.** A leave request is not a request; it is a record of leave
that is taken, effective the moment it is submitted. There is no `status` column.

```
           submit (consumes paid balance)
  (none) ──────────────────────────────► recorded
                                             │
                                             └─ cancel (refunds) ──► row deleted
```

- Cancelling **deletes the row**; there is no cancelled state to read back.
- An employee may cancel only **up to and including the leave's first day**. Once the start
  date has passed the leave is taken, and the attempt is rejected with 400.
- **HR is exempt from that date window** and may cancel past-dated leave as an override
  correction.
- **HR is not exempt from the payroll range lock.** Cancelling is blocked for everyone if
  any part of the leave range overlaps a finalized payroll period — payslips are already out.
- The human coordination approval used to force now lives in the client: submitting opens a
  confirmation step reminding the employee to clear the dates with their team and project
  manager first. It is a nudge, not an audit trail; nothing about it is stored.

### Overlap and reservation

A new request is rejected if it overlaps **any** existing leave record for the same
employee. The check spans all types — a paid, a sick and an unpaid record cannot cover the
same dates.

**Balance is consumed at submission, not merely checked.** The overlap check, the balance
check, the FIFO consumption and the insert are one transaction, so two concurrent
submissions cannot both spend the same day.

### Visibility

Employees see only their own requests, and an `employeeId` filter supplied by an employee
is **ignored, not honoured**. HR calling the single-employee balance endpoint must name an
employee. The leave *calendar*, though, is company-wide for both roles — everyone can see
who is off.

### Notification

On submission every active HR account is notified, in the same transaction that records
the leave. With no approval queue that notification is HR's only signal that leave was
taken, and it stays unresolved until the leave is cancelled — at which point the group is
resolved and HR is told. There is no decision notification, because there is no decision.
See [Notifications](notifications.md).

---

## Payroll

### Periods

One labeled period per `(year, month)`, unique. Each period stores inclusive `startDate` and
`endDate` boundaries. New periods default to the 26th of the previous month through the 25th
of the labeled month; August 2026 therefore defaults to 2026-07-26–2026-08-25. HR may supply
custom dates and may edit both together while the period is DRAFT. FINALIZED ranges are
immutable. Ranges cannot overlap and Start must not be after End. All period administration
is HR-only.

The migration preserves every existing period's calendar-month boundaries so historical
payslips do not change meaning. Consequently, the first new 26–25 period after deployment may
overlap the last legacy calendar period; HR must choose the first uncovered start date for that
one transition period. Later defaults align normally.

| | DRAFT | FINALIZED |
| --- | --- | --- |
| Figures | Recomputed live on every read | Read from stored payslip snapshots |
| Exchange rate | Editable | Frozen |
| Deletable | Yes | No |
| Payslips exist | No | Yes |

**Finalizing is irreversible.** There is no un-finalize endpoint. One transaction writes a
payslip per employee, notifies each of them (one batched insert, not one per employee) and
flips the status. Nothing is dispatched afterwards — if the transaction rolls back, no
employee was told anything.

### The period-range lock

Finalizing a period locks its stored inclusive date range. Any create, update, delete or
review of a dated record in it returns a 409 identifying the labeled period and range. This covers overtime
(create/review/cancel), reimbursements (create/review/cancel), daily logs
(create/update/delete) and leave (submit/cancel). Leave is checked by full-range overlap,
not only by its first day. Each guard takes a shared lock on overlapping payroll rows inside
the same transaction as its mutation; finalization takes the exclusive lock, so neither can
slip a source write between payroll calculation and the FINALIZED transition.

### Who gets a payslip

Every employee whose **employment overlaps the stored range** — not merely everyone currently
employed. Somebody terminated during it still earns the working days their employment covers,
and the old `isActive` filter had no way to say so: it erased them from the period entirely,
so their final partial pay was zero. A part-timer with no logged hours still receives a
zero-value payslip.

### Proration

A full-timer's basic salary is prorated by the working days their employment actually covers:

```
basicSalary = monthlySalary × workedWorkingDays / workingDaysInPeriod
```

Dividing by the stored range's **real** working-day count can never pay more than a full
monthly salary or less than zero, so it needs no cap and no floor. Someone employed through
the range's final working day is paid in full. Terminate-and-rehire inside one range sums
both segments.

Part-timers are not prorated — they are paid per logged hour, so their logs simply stop.

**The accepted inconsistency:** a day not worked because of termination is valued at
`salary / actualWorkingDays`, while a day of sick or unpaid leave is valued at `salary / 21`
via the hardcoded divisor in `lib/payroll.ts`. Both can appear on one payslip. Unifying them
would change the value of every existing leave deduction, including in finalized months, so
it was deliberately left alone.

`detail.proration` is present **only** on a partial month; its absence is what the payslip
PDF keys off to decide whether to print a proration line at all.

**Everything dated is clipped to the employment before it reaches the arithmetic.** Fetching
by date range alone is not enough — a record can sit outside the employment, most easily when
a termination is recorded late, so entries were filed for days the employee turns out not to
have been employed for. Leave is a range and is truncated; overtime, daily logs and
reimbursements are dropped. Without this, a sick leave running past the last day deducts
salary for days nobody was paid for, and overtime dated after it pays somebody who had left.

**The leave deduction is capped at the basic salary.** Proration shrinks `basicSalary` with
the days worked while the deduction keeps the full-month `/21` rate, so the two can cross:
somebody employed 1–15 September and sick throughout computed 11,000,000 against 11,523,810
— a payslip of *minus* 523,810. Zero is the answer, and a payroll system must never issue a
negative net. The cap sits after the clipping above, so it only absorbs the residue of the
two divisors disagreeing.

The attendance block is also scoped to the employment, so it cannot read "scheduled 22 /
actual 22" beside "worked 11 of 22" — the sort of contradiction an employee brings to HR to
dispute their pay.

### Termination and rehire

Ending employment goes through `POST /employees/:id/terminate` with an effective date and a
reason. The date is HR's to choose and need not match `contractEndDate` — people leave early
and people stay on. A past date records a termination late; a future one serves notice, and
the employee stays `ACTIVE` until it passes, with nothing scheduled to flip them.

A termination dated in the future is a **notice period**, and the employee is still employed
throughout it: they keep accruing leave for the months they work, and they can still file
leave, overtime, reimbursements and daily logs. "Currently employed" therefore means *open or
serving notice* everywhere — a definition that must stay consistent, since accrual and leave
submission originally disagreed with the other three paths about it.

**Every dated submission is checked against the date of the RECORD, not against today.**
`assertEmployed(employeeId, date)` refuses overtime, reimbursements and daily logs dated
outside any employment. Checking "employed right now" instead let somebody on notice file
entries dated after their last day: the submission was accepted, then payroll — which selects
by employment overlap — dropped them from that month entirely, so the hours were never paid
and surfaced nowhere.

**`Employee.joinDate` and the first `Employment.startDate` move together.** Correcting the
join date updates both; only the earliest employment, since after a rehire the current one's
start date is the rehire date and legitimately differs. Everything downstream reads
`startDate`, so leaving them unsynced showed HR the corrected date while payroll used the old.

Terminating also:

- brings accrual up to date, then freezes the remaining balance onto
  `Employment.leaveBalanceAtEnd` and forfeits it. It is **not** paid out; the recorded number
  leaves a manual payout possible outside the app. The figure is computed **after** the trim
  below, from the rows that actually survive — reading it beforehand over-reported by exactly
  the months between the effective date and the date HR entered it;
- deletes accrual rows granted **after** the termination month that have no days consumed —
  these only exist when a termination is recorded late. A row with days already spent is left
  alone, because deleting it would strand the leave record that drew from it;
- revokes access on the next request, and stops new leave, overtime, reimbursements and
  daily logs.

`POST /employees/:id/rehire` opens a **new** employment. The previous one is never reopened:
reopening would resurrect its accrual rows and hand back days earned under a contract that
has ended. The rehire date must be after the previous end date, because overlapping
employments would double-count working days in proration.

### Contract-end reminders

There is no scheduler in this system. `ensureContractRemindersUpToDate` follows the same
lazy, idempotent catch-up pattern as `ensureAccrualsUpToDate`: it finds open employments
whose `contractEndDate` falls within 30 days and have no unresolved reminder, and emits
`CONTRACT_ENDING` to HR. It runs at boot and whenever HR fetches their notifications.

Idempotency is keyed on **(recipient, employment, contract end date)**, not a timestamp.
Extending a contract therefore **re-arms** the warning for the new date, and an HR account
created after a reminder was issued still receives it — keying on the employment alone meant
the first HR user "used up" the reminder and later accounts saw nothing. Contracts that have
already lapsed are included deliberately: one that expired unnoticed is more urgent, not less.
Somebody already serving notice is excluded — there is no contract to renew.

The job takes a transaction-scoped **advisory lock**, because it runs at boot *and* on every
HR notification fetch, so two callers can genuinely overlap. Terminating an employment
resolves its outstanding reminder.

### The calculation

```
totalIdr = basicSalary + overtimePay + reimbursementTotal − leaveDeduction
totalUsd = totalIdr / exchangeRate
```

**There is no gross/net split** — no PPh 21 income tax, no BPJS, no allowances, no other
deductions. This is out of scope by explicit design decision, not an oversight.

Rounding is applied per component before summing: IDR to whole rupiah, USD to two decimals.

| | Full-time | Part-time |
| --- | --- | --- |
| `basicSalary` | `monthlySalary`, flat | Σ logged hours × `hourlyRate` |
| `derivedHourly` | `monthlySalary / 21 / 8` | — |
| `dailyRate` | `monthlySalary / 21` | — |
| `overtimePay` | Σ approved OT hours × `derivedHourly` | Always 0 |
| `leaveDeduction` | Sick working days × `dailyRate` | Always 0 |
| `reimbursementTotal` | Σ approved, in-period | Same |

The **21** is a hardcoded assumed working-day month. It does not vary with the actual number
of working days.

**Overtime pays a flat 1.0× multiplier** — there is no Indonesian statutory 1.5×/2× premium.

**Sick deduction** clips requests to the stored period boundaries and excludes weekends
and off-day holidays, so only the in-period working days deduct. Joint leave is worked, so a
cuti bersama day inside the request does deduct.

**Daily logs count regardless of status** — they have no approval workflow at all.

### Exchange rate

Fetched live from a public API when the period is created, then **frozen into the period row
and never re-fetched**. On any failure — network, bad status, unusable shape, non-positive
value — it falls back to a hardcoded **16,000**.

`rateSource` records the provenance so nobody has to guess: `API` (live), `FALLBACK` (the
fetch failed), `MANUAL` (HR overrode it).

### THR

`Employee.thrEligible` exists in the schema, the validation, the service, the seed and the
UI. **Nothing computes THR.** There is no eligibility rule, no calculation, no payslip
component, no date logic. The flag is record-keeping only.

The seed marks full-timers eligible and part-timers not, which is the closest thing to a
stated rule anywhere in the project.

---

## Overtime

- **Full-time only.** Part-timers get 403.
- 0.5–12 hours in half-hour steps; description required.
- At most one PENDING-or-APPROVED entry per employee per date. A rejected entry frees the
  date up again.
- PENDING → APPROVED or REJECTED, HR review only, reason required on reject, cancel is a
  hard delete of a PENDING row. **Leave no longer works this way** — overtime and
  reimbursements are the only records still reviewed.
- **Cancel is owner-only — HR cannot cancel someone else's overtime**, unlike leave.
- Reaches payroll as approved, in-period entries.

---

## Reimbursements

- Any employee, either employment type.
- Amount in IDR, must be positive.
- **An evidence file is mandatory at creation.** PDF, JPEG or PNG, 5 MB cap.
- PENDING → APPROVED/REJECTED lifecycle, HR review, reason required on reject.
- Cancel is owner-only, PENDING-only, and unlinks the file from disk.
- Evidence download is restricted to HR or the owner, and the stored filename is
  `basename`d to block path traversal.
- Reaches payroll at face value, approved and in-period.

---

## Daily logs

The mirror image of overtime.

- **Part-time only.** Full-timers get 403.
- **No approval workflow at all** — there is no status column, the same as leave. A log
  counts toward pay the moment it is written.
- Exactly one log per employee per date, enforced by both a pre-check and a unique index.
- 0.5–24 hours in half-hour steps; project required, notes optional.
- Editable and deletable by the owner **or** HR. Moving a log to a different date re-checks
  the payroll lock on **both** the old and the new date, plus the uniqueness clash at the
  destination.

Since logs feed pay with no approval step and employees can edit their own, this is
effectively self-service pay input.

---

## Holidays

Four types: `NATIONAL`, `COMPANY`, `JOINT_LEAVE` (*cuti bersama*), `SPECIAL`.

**The type decides whether the day is worked.**

| Type | Worked? | Effect |
| --- | --- | --- |
| `NATIONAL` | No | Day off for everyone, deducted from nobody |
| `COMPANY` | No | Same |
| `SPECIAL` | No | Same; folded in with `COMPANY` on the payslip |
| `JOINT_LEAVE` | **Yes** | An ordinary working day — the row exists so the calendar can show it |

`JOINT_LEAVE` (*cuti bersama*) counting as a working day is the load-bearing part. Employees
work those days, so leave taken across one **does** consume it: a sick leave spanning the three
Idul Fitri cuti bersama days deducts for all three.

This was not always so. The type used to be purely cosmetic — every consumer selected only the
date — which made cuti bersama a free non-working day that was charged to nobody and quietly
under-deducted leave. The policy now lives in one place, `lib/workingDays.ts`, and every caller
of `countWorkingDays` must route its holiday rows through `offDayHolidayKeys` or the old
behaviour silently returns.

Payslips finalized before the change keep their original figures; they are snapshots and are
never recomputed.

Other rules:

- `date` is unique globally — two holidays cannot share a date.
- All employees can read; only HR can write.
- Holiday mutations are **not** period-locked. Editing a holiday inside a finalized range is
  allowed, which is harmless because payslips are snapshots — including the attendance summary,
  which is frozen at finalize for exactly this reason.
- Holidays affect payroll only indirectly, by shrinking the deducted sick/unpaid day count.
  They never reduce basic salary — the ÷21 divisor is fixed.

### Attendance summary

Frozen into `Payslip.detail.attendance` at finalize and rendered on the payslip PDF. For a
full-timer the figures reconcile exactly:

```
scheduled = actual + national + company + leave
calendar  = scheduled + dayOff
```

`scheduled` counts every weekday in the period, holidays included; the holiday and leave lines
then take days back off it. `leave` counts **all three** leave types — `PAID` deducts no money
but is still a day absent. Joint leave appears on no line: those days are worked, so they stay
inside `actual`.

A part-timer has no fixed schedule, so `actual` is the count of distinct dates they logged, not
a residual, and the identity does not apply to them.

---

## Notifications

In-app only. There is no email anywhere in the system — no SMTP, no nodemailer, no
`Payslip.emailSentAt`. Every notification is delivered in-app, reached from a sidebar entry
and a bell in the header.

Seven events, and no others:

| Recipient | Event | Emitted from |
| --- | --- | --- |
| HR | `LEAVE_SUBMITTED` | `submitLeave` |
| HR | `OVERTIME_SUBMITTED` | `createOvertime` |
| HR | `REIMBURSEMENT_SUBMITTED` | `createReimbursement` |
| HR | `REQUEST_CANCELLED` | `cancelLeave`, `cancelOvertime`, `cancelReimbursement` |
| Employee | `OVERTIME_DECIDED` | `reviewOvertime` |
| Employee | `REIMBURSEMENT_DECIDED` | `reviewReimbursement` |
| Employee | `PAYSLIP_AVAILABLE` | `finalizePeriod` |

The `NotificationType` enum still carries an eighth value, `LEAVE_DECIDED`. Nothing emits
it since leave lost its approval step, but production holds rows written before that, so
the value and its client-side copy stay.

Daily-log submissions, accrual credits and user-creation are deliberately silent.

**Emission happens inside the transaction that causes it**, so a rolled-back decision
leaves no notification behind. The three `*_SUBMITTED` events fan out to every active HR
account and resolve together the moment one of them acts — or, for leave, when it is
cancelled.

The mechanics — group keys, auto-resolve, payload shapes, why `entityId` is not a foreign
key, and what is deliberately not notified — live in
[notifications.md](notifications.md). Read it before adding an emission site.

---

## Employee lifecycle

**Employment type** is the single switch governing paid leave, overtime, daily logs,
accrual, and the payroll branch.

**`joinDate`** has exactly one behavioural use: the start month for accrual catch-up. It does
not gate payslip generation, leave eligibility, or probation.

**Contract dates and the contract file are stored, validated, and read by nothing.** An
expired contract has no effect on anything.

**There is no hard delete.** Deactivating an employee stops accrual, drops them from the
balances list and from payroll — but does **not** remove their future-dated leave.

An authenticated account with no linked employee degrades gracefully: empty lists rather
than errors, and a 400 on submission attempts.

---

## Worked example — leave balance

Full-timer, joined 2025-01-15, active. Today is 2026-07-30.

1. Accrual catch-up runs from 2025-01 through 2026-07 inclusive → **19 rows**, 1 day each.
2. Each expires 18 months after its period: the 2025-01 row expires 2026-07-01, the 2025-02
   row 2026-08-01, and so on.
3. Say 4 days were taken earlier. FIFO took them from the four oldest-expiring rows:
   2025-01 through 2025-04, each now fully consumed.
4. Today: `accruedTotal = 19`, `usedTotal = 4`. The 2025-01 row **has** expired, but its
   remaining is 0, so `expiredTotal = 0`. **Balance = 15.** Identity holds: 19 = 4 + 0 + 15.
5. New paid leave for Mon 2026-08-03 → Fri 2026-08-07, no holidays, counts as **5** working
   days. 15 ≥ 5, so it is accepted — and consumed there and then, in the same transaction.
6. Consumption loads only unexpired rows — 2025-01 is excluded entirely — in expiry order.
   2025-02 through 2025-04 are already empty and are skipped. One day each comes from
   2025-05, 06, 07, 08 and 09.
7. Result: `accruedTotal = 19`, `usedTotal = 9`, **balance = 10**.
8. Cancelling that leave on 2026-08-01 refunds in reverse: 2025-09, 08, 07, 06 and 05 each
   get their day back, and the balance returns to 15.

**The counter-case matters more.** Had those 4 days never been taken, the 2025-01 row's
unused day would have hit its expiry on 2026-07-01 and moved to `expiredTotal`, giving a
balance of 18 out of 19 accrued. Silently lost, with no way to reclaim it.

---

## Worked example — payslip

Budi, full-time, Rp 10,000,000/month. Period 2026-07, rate 16,000 (`FALLBACK`).
Source rows: 3h approved overtime on 2026-07-10; an approved Rp 200,000 reimbursement on
2026-07-01; sick leave spanning 2026-06-29 → 2026-07-02; unpaid leave 2026-07-13 → 2026-07-15.

| Step | Value |
| --- | --- |
| `derivedHourly = 10,000,000 / 21 / 8` | 59,523.81 |
| `dailyRate = 10,000,000 / 21` | 476,190.48 |
| `basicSalary` | **10,000,000** |
| `overtimePay = 3 × 59,523.81` | **178,571** |
| `reimbursementTotal` | **200,000** |
| Sick days clipped to July → Jul 1 (Wed), Jul 2 (Thu) | 2 days |
| Unpaid days → Jul 13 (Mon), Jul 14 (Tue), Jul 15 (Wed) | 3 days |
| `leaveDeduction = (2 + 3) × 476,190.48` | **2,380,952** |
| `totalIdr = 10,000,000 + 178,571 + 200,000 − 2,380,952` | **7,997,619** |
| `totalUsd = 7,997,619 / 16,000` | **499.85** |

The June portion of that sick leave (Jun 29–30) is not deducted here — it would deduct
against a separate June period.

**`leaveDeduction` is rounded once over the combined day count**, not per type. Rounding each
type separately would let the two payslip breakdown lines disagree with the total they sum
to. Because of that, the per-type rupiah figures on the payslip are *derived* for display —
the sick line is computed and the unpaid line takes the remainder, so the two always
reconcile exactly to the stored `leaveDeduction`.

---

## Where the code and the design document disagree

The design document is `docs/plans/2026-07-08-hrms-design.md`. These are recorded so nobody
"fixes" the code to match a stale document, or vice versa, without deciding which is right.

1. **Accrual restore on cancellation** now exists, unwinding live rows in FIFO order. The design's other half
   — restore on *rejection* — is moot: there is no rejection any more.

2. **The Owner account is gone.** The design still references `OWNER_EMAIL` and "HR + Owner"
   notification. There is no such config, notifications go to active HR accounts, and a
   migration removed the seeded owner. **The document is stale, not the code.**

3. **Accrual grants a day for the join month and the current incomplete month**, contradicting
   "per completed month of service" in the design, the schema comment, *and* the code's own
   comment. The tests pin the current behaviour.

4. ~~**Part-time sick leave has no payroll consequence.**~~ **Resolved.** Leave is now a
   full-time-only feature; a part-timer cannot record leave of any kind, so the case the
   design and the code disagreed about can no longer arise. The part-time payslip branch
   still hardcodes zero deducted days, which now only matters for historical records.

5. **Daily logs are employee-editable**, not HR-only as the design says. Combined with the
   absence of an approval step, employees edit their own pay input.

6. ~~**Leave submission bypasses the finalized-period lock.**~~ **Resolved.** Submission and
   cancellation now lock every overlapping payroll period row and reject any overlap with a
   finalized range.

7. ~~**The period lock only inspects a leave record's `startDate`.**~~ **Resolved.** Leave uses
   its full inclusive range for both submission and cancellation.

8. **No proration rule exists for payroll**, in the code or the design. An employee hired in
   August, if active when a July period is finalized, receives a full July salary.

9. **THR is a field with no rule behind it** — statutory in Indonesia (Permenaker 6/2016: one
   month's wage at 12+ months' service, prorated below), but never defined or computed here.

10. **Six endpoints exist that the design's API list omits** — the three delete routes, the
    evidence download, the payroll-period delete, and the balances list. Documentation lag
    only.

### Deliberate divergences from Indonesian labour norms

Code and design agree on these; both differ from common practice. Listing them so they are
not mistaken for bugs:

- Overtime pays flat 1.0×, with no Kepmenaker 102/2004 premium.
- *Cuti bersama* does not deduct from annual leave.
- The statutory 12-day annual leave entitlement after 12 months is replaced by the
  1-day/month plus 18-month-expiry scheme — an explicit author decision.
- PPh 21 and both BPJS schemes are absent by declared scope.
