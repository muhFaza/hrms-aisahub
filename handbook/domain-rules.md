# Domain rules

The HR policy this system actually encodes. Where the code and the thesis design document
disagree, **the code is described here** and the disagreement is recorded at the bottom.

This is the most important page in the handbook. Everything else is mechanics; this is the
behaviour people will argue about.

---

## Leave

### Types

Two, and only two: `PAID` and `SICK`. There is no maternity, unpaid, or bereavement
category.

| | Who can request | Consumes balance | Payroll effect |
| --- | --- | --- | --- |
| `PAID` | Full-time only | Yes, FIFO | None |
| `SICK` | Both types | No | Deduction — full-timers only |

### How paid leave is earned

Not an annual grant. **One day per month, expiring 18 months after the month it was earned**,
stored as one row per employee per month.

Accrual rows are generated only for employees who are **full-time and active**. The
generator runs at server boot (non-blocking), and on demand before any balance read or paid
leave submission. There is no cron job.

The catch-up loop runs from the **start of the join month** through the **start of the
current month**, inclusive at both ends. Two consequences follow:

- Someone hired on the 30th receives a full day that same day.
- The current, incomplete month has already granted its day.

This contradicts the "per completed month of service" wording in the design document, the
schema comment, and the code's own comment — but it is the tested, pinned behaviour.

### Balance

```
balance      = Σ (days − daysConsumed) over rows that have NOT expired
accruedTotal = usedTotal + expiredTotal + balance     ← always holds
```

A row expires when `expiresAt <= now` — *at* the instant, not after. `expiredTotal` counts
only the **unused remainder** of expired rows.

"Expiring soon" means an unexpired row with days remaining that expires within 60 days.

`sickTaken` is a **lifetime** total, not per-year.

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
the same transaction as the delete. SICK leave refunds nothing, because it consumed nothing.

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
Saturdays, Sundays, and any date in the `Holiday` table. All arithmetic is UTC.

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
- **HR is not exempt from the payroll month lock.** Cancelling is blocked for everyone if
  the leave's **start month** is in a finalized payroll period — payslips are already out.
- The human coordination approval used to force now lives in the client: submitting opens a
  confirmation step reminding the employee to clear the dates with their team and project
  manager first. It is a nudge, not an audit trail; nothing about it is stored.

### Overlap and reservation

A new request is rejected if it overlaps **any** existing leave record for the same
employee. The check spans both types — a paid and a sick record cannot cover the same dates.

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

One period per calendar `(year, month)`, unique. All period administration is HR-only.

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

### The month lock

Finalizing a period locks that calendar month. Any create, update, delete or review of a
dated record in it returns `409 Payroll period YYYY-MM is finalized`. This covers overtime
(create/review/cancel), reimbursements (create/review/cancel), daily logs
(create/update/delete) and leave (cancel).

**Leave *submission* is not covered** — an employee can record leave dated inside a closed
month, and it will not be reflected in the payslips already issued for it.

### Who gets a payslip

Every employee with `isActive: true`. **No join-date, contract-date, or activity filter.**
A part-timer with no logged hours receives a zero-value payslip.

There is **no proration.** A full-timer's basic salary is their monthly salary, flat,
regardless of when they joined or whether their contract has ended.

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

**Sick deduction** clips cross-month requests to the period boundaries and excludes weekends
and holidays, so only the in-period working days deduct.

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
  the payroll lock on **both** the old and the new month, plus the uniqueness clash at the
  destination.

Since logs feed pay with no approval step and employees can edit their own, this is
effectively self-service pay input.

---

## Holidays

Four types: `NATIONAL`, `COMPANY`, `JOINT_LEAVE` (*cuti bersama*), `SPECIAL`.

**The type is purely cosmetic.** Every consumer — leave day counting, payroll sick counting,
the dashboard — selects only the date, with no filter on type. The type surfaces solely as a
colour and label in the UI.

The practical consequence is worth stating plainly: **cuti bersama is a free non-working day
here. It does not deduct from anyone's paid-leave balance.** Standard Indonesian practice
charges cuti bersama against annual leave. Neither the code nor the design document encodes
that deduction.

Other rules:

- `date` is unique globally — two holidays cannot share a date.
- All employees can read; only HR can write.
- Holiday mutations are **not** period-locked. Editing a holiday inside a finalized month is
  allowed, which is harmless because payslips are snapshots.
- Holidays affect payroll only indirectly, by shrinking the sick-day count. They never
  reduce basic salary — the ÷21 divisor is fixed.

---

## Notifications

In-app only. There is no email anywhere in the system — no SMTP, no nodemailer, no
`Payslip.emailSentAt`. Every notification is delivered through the bell in the app header.

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
2026-07-01; sick leave spanning 2026-06-29 → 2026-07-02.

| Step | Value |
| --- | --- |
| `derivedHourly = 10,000,000 / 21 / 8` | 59,523.81 |
| `dailyRate = 10,000,000 / 21` | 476,190.48 |
| `basicSalary` | **10,000,000** |
| `overtimePay = 3 × 59,523.81` | **178,571** |
| `reimbursementTotal` | **200,000** |
| Sick days clipped to July → Jul 1 (Wed), Jul 2 (Thu) | 2 days |
| `leaveDeduction = 2 × 476,190.48` | **952,381** |
| `totalIdr = 10,000,000 + 178,571 + 200,000 − 952,381` | **9,426,190** |
| `totalUsd = 9,426,190 / 16,000` | **589.14** |

The June portion of that sick leave (Jun 29–30) is not deducted here — it would deduct
against a separate June period.

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

4. **Part-time sick leave has no payroll consequence**, though the design says sick is
   unpaid and deducts. A part-timer can record sick leave, but the part-time branch
   hardcodes zero sick days. In practice a part-timer is already unpaid for unlogged days,
   so the outcome is right by accident — the stated rule and the code still disagree.

5. **Daily logs are employee-editable**, not HR-only as the design says. Combined with the
   absence of an approval step, employees edit their own pay input.

6. **Leave submission bypasses the finalized-period lock**, unlike overtime, reimbursements
   and daily logs which all check it on create.

7. **The period lock only inspects a leave record's `startDate`.** Leave spanning a closed
   month into an open one is judged solely by where it starts — so cancelling it can be
   blocked despite it lying mostly in an open month, or allowed despite most of it lying in
   a closed one.

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
