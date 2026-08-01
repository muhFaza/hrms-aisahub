# Known issues and rough edges

Things found while documenting the system that are real but not yet fixed. Nothing here is
on fire. Recorded so nobody has to rediscover them, and so an AI agent working in this
repository does not "helpfully" report them as new findings every session.

Ordered roughly by how much they would matter if the system carried real payroll data.

---

## Security-relevant


**Upload extensions are not validated.** `server/src/middleware/upload.ts` sanitizes the
filename base to `[a-zA-Z0-9-_]` but keeps the client's extension verbatim. The MIME
allowlist (PDF/JPEG/PNG) is checked against the **client-supplied** `Content-Type`, which
is not trustworthy. The saving grace is that uploads are never served statically — there is
no `express.static` mount for the upload directory, and both download endpoints require
authentication and `path.basename()` the stored value. So a hostile file can be stored but
not served as its claimed type.

**`cors()` is configured with no options**, meaning any origin. In practice this is close to
harmless here: auth is a bearer header rather than a cookie, so there is no ambient
authority for a cross-origin page to abuse, and `NODE_ENV=production` disables the CORS
middleware entirely because the SPA is served from the same origin.

**KTP numbers are stored as plain text.** `Employee.ktpNumber` is the Indonesian national
ID. Not unique, not encrypted, and returned in full by the employee detail endpoint to HR.
Appropriate to revisit if this ever holds real personnel data.

---

## Correctness

**Dashboard numbers are stale.** Nothing anywhere invalidates the `['dashboard', …]` query
keys. Approve an overtime claim and the HR dashboard's pending count does not move until a
page reload or a window-focus refetch. Most visible bug in the app.

**`['my-payslips']` is not invalidated by finalize.** An employee with the payslips page
already open will not see a newly finalized payslip until they reload.

**Multer size errors surface as 500.** `errorHandler` has no `MulterError` branch, so
exceeding the 5 MB upload cap produces a generic 500 instead of a 400 with a usable
message. A one-line fix.

**`validate` reassigns `req.query`.** This works on Express 4 and will break on Express 5,
where `req.query` is a getter. Worth knowing before anyone attempts that upgrade.

---

## Inconsistencies that read like drift

**HR can cancel someone's leave but not their overtime or reimbursement.**
`leave/service.ts` allows an HR bypass on cancel — including past the date window an
employee is held to; `overtime/service.ts` and `reimbursements/service.ts` check
`employeeId !== actor.employeeId` with no such bypass.
This may be intentional, but the three flows are otherwise symmetrical, so it reads like
an oversight.

**"Pending first" comments do not match the code.** The overtime and reimbursement list
queries order by `status: 'asc'`, which is alphabetical over the enum — APPROVED, then
PENDING, then REJECTED. The comment above each says `// Pending first`.

**The payroll month divisor is hardcoded.** `lib/payroll.ts` uses 21 working days per month
to derive daily and hourly rates. It is a constant in the file, not configuration, and it
does not vary with the actual number of working days in the month.

---

## Data integrity

**Deleting a `User` silently destroys audit attribution.** Four foreign keys are
`ON DELETE SET NULL`, so a deleted user leaves approved overtime, approved reimbursements,
finalized payroll periods and resolved notifications with timestamps but no actor. Their
own notifications cascade away entirely. See
[data-model.md](data-model.md#the-set-null-trap). The owner-removal migration is the
reference for doing this correctly.

**Several columns lack constraints the application assumes:**
- `PayrollPeriod.month` has no CHECK for 1–12
- `rateSource` is `TEXT`, not an enum, and nothing validates its three documented values
- `DailyLog.hours`, `Overtime.hours` and `Reimbursement.amount` have no CHECK for a sane range
- `rejectReason` is not tied to `status = REJECTED`
- Nothing prevents flipping a `FINALIZED` period back to `DRAFT` while payslips exist

**Raw SQL updates leave `updatedAt` stale**, because it is maintained by Prisma rather than
a database trigger.

**No foreign key has a plain index.** Of 13, only four are index-backed, each incidentally
via a unique constraint. Invisible at current scale; the cheapest available improvement
when someone next touches the schema.

---

## Seed and fixtures

**The seed wipes the database.** `seed.ts` opens with `deleteMany()` across all eleven
tables. The container entrypoints guard it with an emptiness check; the bare
`pnpm prisma:seed` command has no guard at all.

**Seeded accruals stop at a hardcoded 2026-07.** Run the seed in 2027 and every full-timer's
leave balance will be short by the intervening months.

**Seeded accrual consumption is written by hand.** The seed inserts leave rows directly
rather than going through `submitLeave`, so it mirrors the FIFO draw itself for the one
seeded `PAID` record. If the consumption rule changes, that mirror has to change with it.

**`COMPANY` and `SPECIAL` holiday types have no seeded example.**

---

## Operational

**An automated deploy leaves no rollback point.** Rollback requires tagging the running
image *before* deploying, and CI does not do this. It also rolls back code only — a
migration applied by the newer image stays applied, and Prisma has no down-migrations.

**There are no automated database backups.** Take a `pg_dump` before any release carrying a
migration.

**After this branch merges, CI will need `psql`.** The test suite's global setup shells out
to `psql` to create the test database. Confirm the runner image provides it, or add an
install step.

---

## Rule-level gaps

These are behaviours rather than defects, but each one could produce a wrong number or a
stuck record. Full detail and citations in
[domain-rules.md](domain-rules.md#where-the-code-and-the-design-document-disagree).

- **A cancellation can refund days to a row that has already expired.** Nothing records
  which accrual rows a given leave drew from, so the refund is a reconstruction: it unwinds
  non-expired rows first in FIFO order, then expired ones. Days that land on an expired row
  are unspendable and lost. This is accepted, not a defect — crediting a live row instead
  would silently extend an expiry date and manufacture balance, which is worse on a payroll
  system. Live rows are exhausted first, so an expired row only ever absorbs a remainder,
  and the cancel-before-start window keeps that rare: it needs leave booked far enough ahead
  that an accrual expires before the leave begins.
- **Leave taken in error is only recoverable by HR.** An employee cannot withdraw leave once
  its start date has passed; HR can, and the days are refunded. Inside a finalized payroll
  month nobody can, so a mistake there needs a manual correction outside the app.
- **Leave submission is the one mutation that does not check the payroll lock.** Leave can
  be recorded into a closed month, where it will not affect the payslips already issued.
- **The payroll lock only inspects a leave record's start date.** Leave spanning a closed
  month into an open one is judged solely by where it starts.
- **Unused accrual days expire silently** and cannot be reclaimed.
- **THR is a flag with no rule behind it** — statutory in Indonesia, never computed here.

## Cosmetic

- `client/src/pages/PlaceholderPage.tsx` is dead code, imported nowhere.
- The `/my-*` client routes carry no `RequireRole` guard. Not a vulnerability — the server
  scopes every one of those queries to the caller's own employee record — but the client
  guard is inconsistent with the rest of the routing table.
- Every module redefines an identical `idParamSchema`.
- `getBalances` loops per employee serially, which is N+1 by construction. Fine at this scale.
