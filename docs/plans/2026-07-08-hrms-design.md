# HRMS Aisahub — Design Document

**Date:** 2026-07-08
**Source:** `Skripsi_Muhammad Faza_Revisi.md` — "Rancang Bangun Sistem Human Resource Management Menggunakan PERN Stack"
**Author decisions confirmed:** TypeScript + Vite, leave = 1 day/month accrual with 18-month expiry, hourly rate = monthly ÷ 21 ÷ 8, live FX rate with HR override, Nodemailer + SMTP, Owner = HR-role account, single-level HR approval for all submissions.

## 1. Overview

Web-based HRMS for Aisahub Inc on the PERN stack (PostgreSQL, Express, React, Node), fully in TypeScript. Two RBAC roles: **HR** and **EMPLOYEE**. Employees are **FULL_TIME** (monthly salary, overtime, paid leave) or **PART_TIME** (hourly, daily activity logging, no paid leave). Deployed to localhost for UAT with seeded dummy data.

Out of scope (per thesis): tax, automatic bank transfer, advanced payroll regulation.

## 2. Repository Structure

pnpm monorepo:

```
HRMS-Thesis/
├── server/                  # Express + TS API (port 5000)
│   ├── src/
│   │   ├── config/          # env, prisma client, mailer
│   │   ├── middleware/      # auth (JWT), rbac, validate (zod), errorHandler, upload (multer)
│   │   ├── modules/         # auth, users, employees, holidays, leave,
│   │   │                    # daily-logs, overtime, reimbursements, payroll, dashboard
│   │   │   └── <module>/    # routes.ts, controller.ts, service.ts, schemas.ts
│   │   ├── lib/             # dates (working-day calc), fx, payslip templates
│   │   └── index.ts
│   ├── prisma/              # schema.prisma, migrations/, seed.ts
│   └── uploads/             # contract files, reimbursement evidence (local disk, gitignored)
├── client/                  # Vite + React + TS (port 5173)
│   └── src/
│       ├── api/             # axios instance + TanStack Query hooks per module
│       ├── components/      # shared UI
│       ├── pages/           # per module
│       ├── layouts/         # AppLayout with role-gated navigation
│       └── lib/             # AuthContext, route guards, formatters (IDR/USD)
└── docs/plans/
```

Libraries: **Prisma** (ORM/migrations), **Zod** (validation, NFR-5), **bcryptjs**, **jsonwebtoken**, **multer**, **nodemailer**, **Ant Design** (tables/forms/calendar), **TanStack Query**, **React Router**, **dayjs**.

## 3. Data Model (Prisma)

- **Role** — id, name (`HR` | `EMPLOYEE`).
- **User** — id, email unique, passwordHash (bcrypt), roleId → Role, employeeId? → Employee (1:1), isActive.
- **Employee** — fullName, nickname, joinDate, position, employmentType (`FULL_TIME`|`PART_TIME`), contractStartDate, contractEndDate, contractFilePath, monthlySalary (Decimal, full-time), hourlyRate (Decimal, part-time), email, university, major, graduationYear, linkedinUrl, religion, thrEligible (bool), bankName, bankAccountNumber, ktpNumber, phoneNumber, isActive. (Field list from thesis interview §2.2.)
- **LeaveAccrual** — employeeId, period (month), days (1), expiresAt (period + 18 months), daysConsumed. Generated monthly for active full-timers (idempotent catch-up job on server start + on-demand recalc). Balance = Σ non-expired (days − daysConsumed). FIFO consumption on approval.
- **LeaveRequest** — employeeId, type (`PAID`|`SICK`), startDate, endDate, totalDays (working days excl. weekends & holidays), reason, status (`PENDING`|`APPROVED`|`REJECTED`), reviewedById, reviewedAt, rejectReason. SICK = unpaid → payroll deduction. Approval of PAID consumes accruals FIFO; rejection/cancellation restores.
- **Holiday** — name, date, type (`NATIONAL`|`COMPANY`|`JOINT_LEAVE`|`SPECIAL`), notes.
- **DailyLog** — employeeId (part-time), date, hours, project, notes. Auto-accepted; HR may edit/delete.
- **Overtime** — employeeId (full-time), date, hours, description, status (`PENDING`|`APPROVED`|`REJECTED`), reviewedById, reviewedAt.
- **Reimbursement** — employeeId, date, amount (IDR), description, evidenceFilePath, status (same states), reviewedById.
- **PayrollPeriod** — year, month, exchangeRate (IDR per USD; fetched from open API, HR-editable), status (`DRAFT`|`FINALIZED`), finalizedAt, finalizedById.
- **Payslip** — payrollPeriodId, employeeId, basicSalary, overtimePay, reimbursementTotal, leaveDeduction, totalIdr, totalUsd, detail (JSON breakdown), emailSentAt. Unique (period, employee).

## 4. Business Rules

**Leave:** full-timers accrue 1 paid-leave day per completed month of service; each accrued day expires 18 months after accrual. Dashboard shows: current balance, used, sick (unpaid) taken, expired. Working-day counting skips weekends and Holiday rows. Email notification to HR + Owner (HR-role accounts) on submission; to employee on decision.

**Payroll (per period = calendar month):**
- Full-time: hourly = monthlySalary ÷ 21 ÷ 8; daily = monthlySalary ÷ 21.
  `total = monthlySalary + (approved OT hours × hourly) + approved reimbursements − (approved SICK days in period × daily)`
- Part-time: `total = (Σ daily-log hours in period × hourlyRate) + approved reimbursements`
- `totalUsd = totalIdr ÷ exchangeRate` (rate auto-fetched at period creation from a free FX API, editable while DRAFT).
- Flow: HR creates DRAFT period → system computes preview per employee → HR adjusts rate / fixes source data → **Finalize** locks the period, snapshots payslips, emails each employee their payslip (HTML). Finalized periods are immutable; source records in a finalized period are locked from edits.

**RBAC:** HR = full access. EMPLOYEE = own data only; payroll admin pages return 403 (UAT scenario). Part-timers see Daily Log (not Overtime/paid-leave request); full-timers the inverse.

## 5. API (REST, `/api/v1`)

`POST /auth/login`, `GET /auth/me` · `GET|POST|PUT /employees`, `GET /employees/:id` (+ contract upload) · `GET|POST|PUT|DELETE /holidays` · `GET|POST /leave`, `PATCH /leave/:id/review`, `GET /leave/balance`, `GET /leave/calendar` · `GET|POST|PUT|DELETE /daily-logs` · `GET|POST /overtime`, `PATCH /overtime/:id/review` · `GET|POST /reimbursements`, `PATCH /reimbursements/:id/review` · `GET|POST /payroll/periods`, `GET /payroll/periods/:id` (preview), `PATCH /payroll/periods/:id` (rate), `POST /payroll/periods/:id/finalize`, `GET /payroll/my-payslips` · `GET /dashboard` (role-scoped) · `GET|POST|PATCH /users` (HR). JWT bearer middleware + role guard on every route; Zod validation on every body/query.

## 6. Frontend Pages

- **Login** → role-based redirect.
- **HR:** Dashboard (headcounts, pending approvals, on-leave-today, payroll status), Employees (table + drawer form + contract upload), Holidays, Leave Review (+ balances table + calendar), Daily Logs review, Overtime review, Reimbursements review, Payroll (period list → preview table → finalize), Users.
- **Employee:** Dashboard (balance, pending items, upcoming holidays), Profile, Leave (request + history + calendar), Daily Log (part-time) / Overtime (full-time), Reimbursement, My Payslips.
- Ant Design; leave/holiday calendar via AntD Calendar; IDR/USD formatting via Intl.

## 7. Error Handling, Validation, Security

Central Express error handler (Zod → 400 with field errors; Prisma known errors mapped; 401/403 distinct). JWT expiry 12h. bcrypt cost 10. File uploads: size/type limits (pdf/images, 5MB), stored under `server/uploads/`, served behind auth. Secrets in `.env` (never committed): `DATABASE_URL`, `JWT_SECRET`, `SMTP_*`, `OWNER_EMAIL` fallback.

## 8. Testing & Verification

Per user preference: implementation first, tests proposed at checkpoints (no TDD). Unit tests (Vitest) target the pure logic: working-day calculation, leave accrual/expiry/FIFO consumption, payroll computation for both employment types. API smoke tests via supertest for auth/RBAC (employee blocked from payroll → 403). Verification command at every checkpoint: `pnpm build` (both workspaces) + `pnpm lint:fix`. Final deliverable includes a UAT script mapping the thesis Table 2.1 scenarios to click-paths, plus seed data: 1 HR, 1 Owner (HR role), 2 full-time, 2 part-time employees, 2026 Indonesian national holidays, sample leave/logs/overtime/reimbursements, and one DRAFT payroll period.
