# Data model

PostgreSQL via Prisma. 11 models, 5 enums, 5 migrations. Schema at
`server/prisma/schema.prisma`; Prisma CLI configuration at `server/prisma.config.ts`.

Every primary key is `Int @id @default(autoincrement())`.

---

## Entities

### `Role`
Two-row lookup table: `HR` and `EMPLOYEE`. `name` is unique. Role names are free text —
there is no enum and no CHECK constraint, so a typo'd role name would be accepted.

### `User`
A login account. Either an HR account with no employee profile, or an employee account
linked 1:1 to an `Employee`.

| Field | Notes |
| --- | --- |
| `email` | unique |
| `passwordHash` | bcrypt, cost 10 |
| `roleId` | required, FK → `Role`, `ON DELETE RESTRICT` |
| `employeeId` | nullable and **unique** — this is what enforces one account per employee. `ON DELETE SET NULL` |
| `isActive` | soft-disable flag, checked on every request |

### `Employee`
The HR master record: identity, contract, compensation, banking.

Notable fields: `employmentType` (required, no default — drives all salary logic),
`monthlySalary` and `hourlyRate` (both nullable `Decimal(15,2)`; which one applies depends
on employment type), `thrEligible` (Tunjangan Hari Raya — the Indonesian religious-holiday
bonus), `ktpNumber` (national ID, stored as plain text), and `contractFilePath`.

`Employee.email` is separate from `User.email` and is **not unique** — it is the payslip
delivery address.

### `LeaveAccrual`
One row per employee per month, recording the paid-leave day earned and how much of it has
been spent.

| Field | Notes |
| --- | --- |
| `period` | first day of the accrual month, at UTC midnight |
| `days` | defaults to 1 |
| `daysConsumed` | defaults to 0 |
| `expiresAt` | `period` + 18 months. **No default and no generated expression** — the rule lives only in application code |

Unique on `(employeeId, period)`, plus a CHECK constraint
`daysConsumed >= 0 AND daysConsumed <= days` added by migration 4.

Expiry is computed at read time. There is no `expired` column and no job that flips rows.

### `LeaveRequest`
A leave request over a date range, with an HR decision.

`totalDays` is working days excluding weekends and holidays, **computed by the application
and unverifiable by the database**. `reviewedById` is nullable, `ON DELETE SET NULL`.
`rejectReason` has no constraint tying it to `status = REJECTED`.

### `Holiday`
Standalone table, no foreign keys — joined only by date value in application code.
`date` is `@unique`, so two holidays cannot share a calendar date.

### `DailyLog`
A part-timer's hours on a date. Unique on `(employeeId, date)` — one log per person per
day. `hours` has no CHECK constraint.

### `Overtime`
Overtime hours claimed on a date, subject to HR approval. Note the asymmetry with
`DailyLog`: there is **no** unique on `(employeeId, date)`, so multiple overtime rows per
day are allowed at the database level.

### `Reimbursement`
An expense claim in IDR with a receipt file path, approved by HR, paid via payroll.
`amount` has no CHECK for `> 0`.

### `PayrollPeriod`
One payroll run for a year/month.

| Field | Notes |
| --- | --- |
| `year`, `month` | unique together. **No CHECK for month 1–12** — `month = 13` is storable |
| `exchangeRate` | `Decimal(15,4)` — IDR per USD, the only non-2dp decimal in the schema |
| `rateSource` | `API` / `FALLBACK` / `MANUAL`. Plain `TEXT` with a default, **not an enum**, no CHECK |
| `status` | `DRAFT` or `FINALIZED` |
| `finalizedById` | nullable, `ON DELETE SET NULL` |

### `Payslip`
The immutable per-employee result, written when a period is finalized. Unique on
`(payrollPeriodId, employeeId)` — that constraint is what makes finalize idempotent.

`detail` is a JSONB snapshot of the full computation. `emailSentAt` is null until the
payslip email is successfully dispatched. There is **no `updatedAt`** — the table is
write-once by design.

---

## Relationships

```
                    ┌──────────┐
                    │   Role   │
                    └────┬─────┘
                         │ roleId (RESTRICT)
                         ▼
   ┌──────────┐  1   ┌──────────┐
   │ Employee │◄─────┤   User   │  employeeId @unique (SET NULL)
   │          │ 0..1 └────┬─────┘  HR accounts have employeeId = NULL
   └────┬─────┘           │
        │                 │ reviewedById / finalizedById  (all SET NULL)
        │                 ├──────────┬──────────────┬───────────────┐
        │ employeeId      ▼          ▼              ▼               ▼
        │ (all RESTRICT)  LeaveRequest  Overtime  Reimbursement  PayrollPeriod
        │                    ▲          ▲            ▲               │
        ├────────────────────┘          │            │               │ payrollPeriodId
        ├───────────────────────────────┘            │               │ (RESTRICT)
        ├────────────────────────────────────────────┘               ▼
        ├──► LeaveAccrual   unique(employeeId, period)           ┌─────────┐
        ├──► DailyLog       unique(employeeId, date)             │ Payslip │
        └──► Payslip ───────unique(payrollPeriodId, employeeId)─►└─────────┘

        Holiday — standalone. No foreign keys.
```

Two delete behaviours, and the difference matters:

- **`RESTRICT`** on every `employeeId` and `payrollPeriodId`. You cannot delete an employee
  who has any accrual, log, request or payslip. This is why employees are deactivated, not
  deleted.
- **`SET NULL`** on all five nullable user references.

### The `SET NULL` trap

None of these delete rules is declared in `schema.prisma` — Prisma emits them implicitly
(required relation → RESTRICT, optional → SET NULL). Reading the schema alone will not
show you this.

Five columns are `SET NULL`, and every one of them destroys **audit attribution** rather
than rows:

| Column | What is lost when the referenced user is deleted |
| --- | --- |
| `User.employeeId` | The login survives with no employee profile — indistinguishable from an HR account at schema level |
| `LeaveRequest.reviewedById` | An APPROVED request with a `reviewedAt` timestamp and no approver |
| `Overtime.reviewedById` | Same, and this one has money attached — approved overtime feeds `Payslip.overtimePay` |
| `Reimbursement.reviewedById` | The approver of a payout becomes unknown |
| `PayrollPeriod.finalizedById` | A FINALIZED period with no finalizer. The sign-off on real disbursements |

**Any code that deletes a `User` must reassign these four attribution columns first.**
Migration 5 does exactly that and is the reference implementation. Nothing in the schema
does it automatically, and no `ON DELETE` variant preserves identity.

---

## Enums

**`EmploymentType`** — how someone is engaged, and therefore how they are paid.
- `FULL_TIME` — salaried against `monthlySalary`; accrues paid leave; may claim overtime.
- `PART_TIME` — hourly, `hourlyRate` × logged hours; no paid-leave accrual; no overtime.

**`LeaveType`**
- `PAID` — draws down the accrual balance, FIFO by expiry date.
- `SICK` — unpaid, no accrual impact, but produces a payroll deduction for full-timers.

**`RequestStatus`** — the shared approval lifecycle for leave, overtime and reimbursements.
`PENDING` → `APPROVED` or `REJECTED`. Only `APPROVED` rows count toward payroll.

**`HolidayType`** — why a date is non-working. All four are treated identically by
leave-day counting; the distinction is classification only.
- `NATIONAL` — Indonesian statutory public holiday.
- `JOINT_LEAVE` — *cuti bersama*, the government-mandated bridge days around Eid or Lunar
  New Year.
- `COMPANY` — a company-declared closure. **No seeded example.**
- `SPECIAL` — one-off. **No seeded example.**

**`PayrollStatus`**
- `DRAFT` — figures recomputed live on every read; exchange rate still editable; no
  payslip rows exist yet.
- `FINALIZED` — payslips written and frozen. There is no "reverted" value and no
  schema-level block on flipping the column back to `DRAFT` while payslips exist.

Adding a value to any enum needs an `ALTER TYPE … ADD VALUE` migration, which cannot run
inside a transaction block on older PostgreSQL — plan it separately from other DDL.

---

## Migration history

Forward-only; Prisma does not generate down migrations.

| Migration | Kind | What and why |
| --- | --- | --- |
| `20260708070133_init` | Schema | All enums, tables, 7 unique indexes, 13 foreign keys. Created **zero non-unique indexes** |
| `…080000_phase4_daily_log_unique_and_reject_reasons` | Schema | Adds `rejectReason` to `Overtime` and `Reimbursement` (bringing them to parity with `LeaveRequest`), and the `DailyLog(employeeId, date)` unique — which stops duplicate hour entries double-billing hourly payroll |
| `…090000_phase5_payroll_rate_source` | Schema | Adds `rateSource`, so an operator can tell whether a payslip's rate was live, fallback, or hand-entered. Backfills existing rows to `'API'` |
| `…100000_leave_accrual_consumption_check` | Constraint | The CHECK on `daysConsumed`. Added because a concurrent-approval race could over-consume an accrual row |
| `20260730120000_remove_seeded_owner_account` | **Data only** | Removes the retired `owner@aisahub.com` account from already-deployed databases, reassigning its four attribution columns to the oldest remaining active HR user first. Idempotent; degrades gracefully if no successor exists |

Migrations 2–4 were all corrective — each fixes something the initial schema left
unguarded. Migration 5 is the only data-only one.

---

## Seed data

`server/prisma/seed.ts`. **It opens by deleting every row in all eleven tables**, in
foreign-key-safe order, then recreates the demo set. It is repeatable, not additive, and
there is no environment guard preventing it from running against production.

Creates: 2 roles, 5 users, 4 employees, 20 Indonesian 2026 holidays, and sample
transactions. All accounts share the password `password123` — a throwaway credential
committed as sample data, which must never be reachable from a deployed environment.

| Account | Role | Employee |
| --- | --- | --- |
| `hr@aisahub.com` | HR | none — no profile |
| `budi@aisahub.com` | EMPLOYEE | Budi Santoso, full-time, Rp 10,000,000/month |
| `sari@aisahub.com` | EMPLOYEE | Sari Wulandari, full-time, Rp 12,000,000/month |
| `andi@aisahub.com` | EMPLOYEE | Andi Pratama, part-time, Rp 50,000/hour |
| `dewi@aisahub.com` | EMPLOYEE | Dewi Lestari, part-time, Rp 60,000/hour |

Holidays are 16 `NATIONAL` + 4 `JOINT_LEAVE`. No `COMPANY` or `SPECIAL` rows exist, so
those two enum values are untested by the seed. The movable-feast dates are
official-approximate values chosen for UAT, not authoritative.

Accruals are generated only for the two full-timers, one row per completed month from their
join date **through a hardcoded end of 2026-07**. Run this seed in 2027 and balances will
be short by every intervening month.

The one seeded approved leave request is `SICK`, so **no seeded accrual row has
`daysConsumed > 0`** — the FIFO consumption path is not exercised by seed data alone. No
payslips are seeded; they only exist after a finalize.

---

## Gotchas

### Dates — the biggest trap

The schema mixes two representations of what are all semantically calendar dates:

- **True `DATE`**: `Holiday.date`, `DailyLog.date`, `Overtime.date`, `Reimbursement.date`
- **`TIMESTAMP(3)` acting as a date**: `Employee.joinDate`, both contract dates,
  `LeaveAccrual.period`, `LeaveAccrual.expiresAt`, `LeaveRequest.startDate`/`endDate`

The codebase compensates by always writing UTC midnight by hand:

```ts
new Date(`${iso}T00:00:00.000Z`)
```

If a new write path builds a `Date` from a local-time string, it lands on the previous day
on any non-UTC machine. For `LeaveAccrual.period` that silently breaks the
`(employeeId, period)` unique constraint — you get two accrual rows for one month instead
of a conflict error.

**Use the existing helpers. Do not construct dates ad hoc.** Also note that Prisma's
`TIMESTAMP(3)` is `timestamp without time zone`; nothing in this schema is zone-aware.

### Money

The database is correct — IDR as `Decimal(15,2)`, the exchange rate as `Decimal(15,4)`. The
application then converts everything to a JavaScript `number` and does the arithmetic in
floating point. At IDR magnitudes (tens of millions, 2dp) doubles have ample headroom, so
nothing is currently being lost. But any change that adds a division, a percentage, or
per-hour proration should move to `Prisma.Decimal` arithmetic rather than extending the
float path.

### Required columns that are easy to miss

- `Employee.employmentType` — no default; every insert must supply it
- `LeaveRequest.totalDays` — application-computed, database cannot verify it
- `LeaveAccrual.expiresAt` — no default, no generated expression; the +18-month rule exists
  only in code
- `Payslip.totalIdr` / `totalUsd` — no defaults, unlike the four component columns
- `PayrollPeriod.exchangeRate` — required, and easy to forget when writing test fixtures

### `updatedAt` is maintained by Prisma, not the database

There is no trigger. **Raw SQL updates leave it stale** — migration 5 does exactly this
when it reassigns `reviewedById`. Any future raw-SQL update has the same effect.

### Missing indexes

The initial migration created no plain indexes at all. Of 13 foreign keys, only four are
index-backed, and each only incidentally, via a unique constraint that happens to lead with
the column.

Two consequences: per-employee list queries and the HR pending-approval queues are
sequential scans; and every `DELETE` on `User` or `Employee` triggers a full scan of each
referencing table to enforce the delete rules.

At current scale this is invisible. Adding `@@index([employeeId, status])` to the three
request tables, plus indexes on the four attribution columns and `Payslip.employeeId`, is
the cheapest available improvement and should accompany the next schema change.
