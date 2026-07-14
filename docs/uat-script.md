# HRMS Aisahub — User Acceptance Testing (UAT) Script

This script maps the thesis UAT scenarios (Skripsi Table 2.1) to concrete click-paths using
the seeded demo data. Run each scenario in order and record the outcome in the **Status**
column (Pass / Fail / Notes).

Reference: [`docs/plans/2026-07-08-hrms-design.md`](plans/2026-07-08-hrms-design.md).

## Prerequisites

1. Install, migrate, and seed the database (see the root `README.md`). The seed is idempotent
   and resets the demo data — re-run `pnpm prisma:seed` to return to a clean state at any time.
2. Start the API and web app:
   - API: `pnpm --filter server start` (after `pnpm build`) or `pnpm --filter server dev`.
   - Web: `pnpm --filter client dev` → open http://localhost:5173.
3. **Email scenarios (5, 9):** Nodemailer sends only when SMTP is configured. Set real SMTP
   credentials in `server/.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
   and set `OWNER_EMAIL` to an inbox you control. Without valid SMTP, submissions/finalization
   still succeed — the email step is logged and skipped, so the rest of each scenario is
   unaffected.
4. The seeded system date context is July 2026 (holidays, logs and the DRAFT payroll period are
   dated around June–July 2026).

### Seeded accounts

All accounts use the password `password123`.

| Email             | Role     | Type      | Notes                            |
| ----------------- | -------- | --------- | -------------------------------- |
| hr@aisahub.com    | HR       | —         | HR administrator                 |
| owner@aisahub.com | HR       | —         | Owner (HR-role account)          |
| budi@aisahub.com  | EMPLOYEE | Full-time | Monthly salary Rp10,000,000      |
| sari@aisahub.com  | EMPLOYEE | Full-time | Monthly salary Rp12,000,000      |
| andi@aisahub.com  | EMPLOYEE | Part-time | Hourly rate Rp50,000             |
| dewi@aisahub.com  | EMPLOYEE | Part-time | Hourly rate Rp60,000             |

## Scenarios

| No | Scenario | Steps (click path) | Expected result | Status |
| -- | -------- | ------------------ | --------------- | ------ |
| 1 | HR login → HR dashboard | Go to `/login` → enter `hr@aisahub.com` / `password123` → **Log in**. | Redirected to `/dashboard`. HR dashboard shows headcount (Total 4, Full-time 2, Part-time 2), Pending Approvals (Leave/Overtime/Reimbursements), Leave Days This Month, On Leave Today, Upcoming Holidays, and Latest Payroll Period (June 2026, DRAFT). | |
| 2 | Employee login → employee dashboard | Log out → log in as `andi@aisahub.com` / `password123`. | Redirected to `/dashboard`. Part-time dashboard shows Logged Hours This Month, My Pending Requests, Latest Payslip, On Leave Today, Upcoming Holidays. No Employees/Payroll/Users nav items. (Log in as `budi@aisahub.com` to see the full-time variant with Leave Balance + Overtime Hours.) | |
| 3 | HR adds a new employee (with contract upload) | As HR → **Employees** → **New Employee** → fill Full name, Join date, Position, Employment type = Full-time, Monthly salary, KTP (16 digits), email, bank details → **Save**. Open the new employee → **Contract** → upload a PDF. | Employee appears in the Employees table. Detail page shows all fields; the uploaded contract is downloadable. | |
| 4 | Part-timer records daily activity → visible to HR | Log in as `andi@aisahub.com` → **Daily Log** → **Add Log** → pick a date, hours, project → **Save**. Log out → log in as HR → **Daily Logs**. | The entry appears in Andi's own list, and HR sees it in the Daily Logs review table (filterable by employee/month). | |
| 5 | Full-timer submits leave → HR + Owner emailed → HR approves | Log in as `budi@aisahub.com` → **My Leave** → **Request Leave** → type = Paid, pick a future weekday range with balance available → **Submit**. (HR + Owner receive a submission email.) Log out → log in as HR → **Leave** → find the pending request → **Approve**. | Request is created (PENDING). HR + Owner receive email (if SMTP set); requester is emailed on decision. After approval: request is APPROVED, Budi's leave **balance decreases** by the working days, and the leave appears on the leave calendar. | |
| 6 | HR adds a holiday → shows in calendars & excluded from leave count | As HR → **Holidays** → **New Holiday** → name, a future weekday date, type = Company → **Save**. Then submit a Paid leave (as a full-timer) spanning that date. | Holiday appears in the Holidays list and on the leave/holiday calendar. A leave range covering that holiday counts one fewer working day (weekends and holidays are excluded from `totalDays`). | |
| 7 | Full-timer submits overtime → HR approves | Log in as `sari@aisahub.com` → **Overtime** → **Submit Overtime** → date, hours, description → **Submit**. Log out → log in as HR → **Overtime** → **Approve** the entry. | Overtime is created (PENDING), then APPROVED. Approved overtime hours feed the payroll preview (overtime pay = hours × monthly ÷ 21 ÷ 8). | |
| 8 | Employee submits reimbursement with evidence → HR approves | Log in as any employee → **Reimbursements** → **Submit Reimbursement** → date, amount, description, attach an image/PDF evidence → **Submit**. Log out → log in as HR → **Reimbursements** → open evidence → **Approve**. | Reimbursement is created (PENDING) with downloadable evidence, then APPROVED. Approved reimbursements are added to that month's payroll total. | |
| 9 | HR creates payroll period → preview → finalize → payslips | As HR → **Payroll** → **New Period** → choose a month with data (e.g. current month) → **Create**. Open the period → review the preview (full-time base + overtime − sick; part-time hours × rate; USD from exchange rate; adjust rate if needed). → **Finalize** → confirm. | Preview shows computed salaries for both employment types with IDR and USD. After finalize: period is FINALIZED (immutable), payslips are snapshotted, each employee is emailed their payslip (if SMTP set), and employees see it under **My Payslips**. | |
| 10 | RBAC: employee blocked from HR pages (403) | Log in as `andi@aisahub.com`. Manually navigate the browser to `/payroll`, then to `/employees`. | Each shows a **403 Access Denied** result page; the pages do not render. (API also returns 403 for these routes with an employee token.) | |
| 11 | Input validation | As HR → **Employees** → **New Employee**. (a) Enter a KTP number that is not 16 digits. (b) Leave a required field (e.g. Full name) blank. (c) Set Employment type = Full-time but leave Monthly salary blank → **Save**. | Each invalid submission is rejected with an inline field error; the record is not created. Full-time without a monthly salary is rejected (server-side Zod validation returns 400 with field details). | |

## Sign-off

| Tester | Date | Overall result | Notes |
| ------ | ---- | -------------- | ----- |
|        |      |                |       |
