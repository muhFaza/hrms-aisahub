# Demo data reset and generation — design

**Date:** 2026-08-06
**Purpose:** Reset the accumulated test data and lay down a coherent, thorough demo dataset
for a 5-minute demo video. Local first, production after sign-off.

---

## Goal

A dataset that lets a 5-minute walkthrough hit every major capability without contrivance:
leave (with accrual, expiry and both deduction types), overtime (approved, rejected, pending),
part-time daily logs, reimbursements with working evidence downloads, one month of finalized
payslips, and one draft month to finalize live on camera.

Four employees, unchanged from the seed:

| | Name | Type | Rate | Joined |
| --- | --- | --- | --- | --- |
| 1 | Budi Santoso | FULL_TIME | Rp 10,000,000 / month | 2024-03-01 |
| 2 | Sari Wulandari | FULL_TIME | Rp 12,000,000 / month | 2025-01-06 |
| 3 | Andi Pratama | PART_TIME | Rp 50,000 / hour | 2025-09-01 |
| 4 | Dewi Lestari | PART_TIME | Rp 60,000 / hour | 2025-10-15 |

Plus the single HR account, `hr@aisahub.com`. All passwords are `password123`.

---

## Decisions taken

| Decision | Choice |
| --- | --- |
| Target | Local dev first, production (`hrms.muhammadfaza.com`) after sign-off |
| Reset scope | Full wipe + re-seed, then strip the seed's own sample rows |
| Period boundaries | The shipped 26–25 cutoff default, not calendar months |
| Payroll end state | June FINALIZED (payslips exist), July DRAFT (finalize on camera) |

---

## Part 1 — Reset

Three steps, in order. Production adds a backup step in front.

### a. Back up (production only)

`pg_dump` inside the `hrms-db` container to `~/hrms-backup-<date>.sql`, then pull a copy
down to the local scratchpad. **Verify the dump is non-empty before proceeding** — step (b)
is unrecoverable without it.

### b. Full wipe + baseline

The shipped seed already opens with `deleteMany()` across all eleven tables, so running it
*is* the reset. It restores 2 roles, the HR account, 4 employee accounts, the 4 employees,
20 Indonesian 2026 holidays and every leave-accrual row.

| Environment | Command |
| --- | --- |
| Local | `pnpm prisma:seed` |
| Production | `docker exec hrms-app node dist/prisma/seed.js` |

The production image ships `dist/prisma/seed.js` because the container entrypoint calls it,
so no build or file copy is needed on the 1 GB box.

### c. Strip the seed's sample rows

The seed lays down scattered sample data of its own — 3 leave records, 2 overtime, 5 daily
logs, 1 reimbursement, and **a June DRAFT payroll period dated 1–30 June**. That period
overlaps the 26 May – 25 Jun period this design wants, and overlapping ranges are rejected
with a 409, so it must go.

One statement, run against the database directly:

```sql
DELETE FROM "Payslip";
DELETE FROM "PayrollPeriod";
DELETE FROM "Reimbursement";
DELETE FROM "Overtime";
DELETE FROM "DailyLog";
DELETE FROM "LeaveRequest";
DELETE FROM "Notification";
UPDATE "LeaveAccrual" SET "daysConsumed" = 0;
```

`Payslip` before `PayrollPeriod` for the foreign key. The `daysConsumed` reset undoes the
seed's FIFO consumption so balances start clean and the generator's own paid leave draws
from a full pool.

Uploads are cleared too — the seed leaves orphaned evidence files behind on the volume.

What survives: roles, users, employees, employments, holidays, leave accruals.

---

## Part 2 — Generation

A re-runnable script, `scripts/demo-data.ts`, run with `pnpm tsx` and taking `--base-url`
so the same code drives local and production.

**It drives the live HTTP API rather than writing SQL.** That is the load-bearing choice:
accrual FIFO consumption, leave overlap rejection, `assertEmployed`, the period-range lock,
notification fan-out inside the causing transaction, evidence files landing on disk, and
payslip computation all run for real. Hand-writing `Payslip.detail` JSON in SQL would
produce a shape the application never generates, and the defect would surface as a wrong
PDF mid-recording.

The script logs in once as HR and once as each of the four employees, then submits each
record as the employee who owns it and reviews it as HR — the same path a real user takes.

---

## Part 3 — The dataset

### Windows

Anchored on the 26–25 cutoff, with today being 2026-08-06:

| Window | Range | Period state |
| --- | --- | --- |
| June | 2026-05-26 → 2026-06-25 | **FINALIZED** — payslips already downloadable |
| July | 2026-06-26 → 2026-07-25 | **DRAFT** — finalized on camera |
| Current | 2026-07-26 → today | No period created; holds the pending queue |

August is deliberately left uncreated so HR can create it on camera if the script calls
for it.

### Leave — full-timers only

Part-timers are blocked from leave by design, so Andi and Dewi have none.

| Who | Type | Dates | Days | Purpose in the demo |
| --- | --- | --- | --- | --- |
| Budi | SICK | 8–9 Jun | 2 | Deduction on the finalized June payslip |
| Sari | PAID | 11–12 Jun | 2 | Consumes balance, produces no deduction |
| Sari | SICK | 29–30 Jun | 2 | July deduction |
| Budi | PAID | 6–8 Jul | 3 | Balance draw inside the draft month |
| Sari | UNPAID | 13–14 Jul | 2 | **Both deduction lines on one payslip** |
| Sari | SICK | 3–4 Aug | 2 | Current-month activity |
| Budi | PAID | 10–12 Aug | 3 | Future leave, visible on the calendar |

A useful property falls out for free: Budi joined March 2024, so twelve of his accrued days
have already passed their 18-month expiry. His balance screen demonstrates the expiry rule
with no contrivance at all.

### Overtime — full-timers only

- **June window:** Budi 3 Jun 3h, Sari 18 Jun 2h — both APPROVED.
- **July window:** Budi 2 Jul 3h, Budi 14 Jul 2.5h, Sari 9 Jul 4h — APPROVED.
  Sari 21 Jul 2h — REJECTED with a reason, exercising the reject path.
- **Current:** Budi 30 Jul 3h, Sari 4 Aug 2h — left **PENDING** for live approval.

At most one PENDING-or-APPROVED entry per employee per date, so no two share a date.

### Daily logs — part-timers only

Roughly 65 rows across Andi and Dewi: most weekdays in each window at 6–8 hours, skipping
weekends and off-day holidays.

| Who | June window | July window | Current |
| --- | --- | --- | --- |
| Andi | ~14 days | ~16 days | ~7 days |
| Dewi | ~10 days | ~12 days | ~5 days |

Projects: Andi on *Website Revamp* and *Mobile App*; Dewi on *Design System* and
*Marketing Site*.

### Reimbursements

Every one carries a real generated PDF uploaded as evidence, so the download button works
on camera. An evidence file is mandatory at creation, so this is not optional.

- **June window:** Budi Rp 350,000 client lunch; Dewi Rp 150,000 design asset licence — APPROVED.
- **July window:** Budi Rp 275,000 client transport; Sari Rp 1,200,000 conference ticket;
  Andi Rp 180,000 co-working day pass — APPROVED. Dewi Rp 450,000 Figma seat — REJECTED
  with a reason.
- **Current:** Sari Rp 600,000 team dinner (29 Jul); Andi Rp 95,000 client transport
  (3 Aug) — left **PENDING**.

### Holidays

One addition to the seeded 20: a `COMPANY` holiday, *Aisahub Company Outing*, on
2026-07-10 — inside the draft window, so it visibly moves the working-day count and gives
the holiday feature something to show.

### Payroll

1. Create the June 2026 period with an explicit range of 2026-05-26 → 2026-06-25, then
   **finalize** it. Writes a payslip per employee and a `PAYSLIP_AVAILABLE` notification to
   each of the four.
2. Create the July 2026 period, 2026-06-26 → 2026-07-25, and leave it DRAFT.

**Ordering constraint:** every June-window record must exist *before* June is finalized,
because finalizing locks the stored range against any further create, edit, review or
cancel. July-window records are unaffected — a DRAFT period locks nothing.

---

## Part 4 — Notification state at t=0

The script runs HR's `read-all` late, then creates the four pending items **last**. The
result is an HR bell badge reading exactly **4**, every one of them actionable on camera.

Andi's contract ends 2026-08-31, inside the 30-day reminder window, so a `CONTRACT_ENDING`
notification also appears on its own the first time HR opens notifications — the lazy
catch-up runs on every HR notification fetch. That is genuine system behaviour, not seeded.

Employees keep a handful of unread notifications including June's `PAYSLIP_AVAILABLE`,
which is realistic and gives the employee-side view something to show.

### Optional polish

A SQL pass backdating `createdAt` on the historical rows so lists do not all read
"just now". Cosmetic only, and it skips the fresh pending items so they still look new.

---

## Risks

**The wipe is unrecoverable.** Production gets a verified `pg_dump` first; the dump is
checked for non-zero size and a plausible line count before step (b) runs.

**Production currently has an August 2026 period wrongly FINALIZED**, which locks every
date in the current month against any mutation. The wipe clears it. That is worth doing
independently of the demo.

**The 1 GB production box** sees roughly 90 API calls from the generator, which is
negligible load — but the run happens against the live container, so it is done in one
pass rather than left half-applied.

---

## Verification

After each run, confirm:

- Row counts match what the script reports it created.
- June payslips exist for all four employees and their figures reconcile
  (`totalIdr = basicSalary + overtimePay + reimbursementTotal − leaveDeduction`).
- The July draft preview computes live without error.
- HR's unread count is 4.
- A reimbursement evidence download returns a PDF rather than
  "No evidence file on record".
- The leave calendar for 2026-08 shows Budi's upcoming leave.
