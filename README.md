# HRMS Aisahub — PERN Stack

Web-based Human Resource Management System for Aisahub Inc, built on the **PERN stack**
(PostgreSQL, Express, React, Node) fully in TypeScript. It implements the thesis
_"Rancang Bangun Sistem Human Resource Management Menggunakan PERN Stack"_
(Muhammad Faza). See [`docs/plans/2026-07-08-hrms-design.md`](docs/plans/2026-07-08-hrms-design.md)
for the full design and [`docs/uat-script.md`](docs/uat-script.md) for the acceptance-test script.

## Features

- **Authentication & RBAC** — JWT login, two roles (HR, EMPLOYEE); HR pages return 403 for employees.
- **Employees** — full profile CRUD with contract file upload, served behind auth.
- **Holidays** — CRUD plus a color-coded calendar; national/company/joint-leave/special types.
- **Leave** — 1 day/month accrual with 18-month expiry, FIFO consumption, working-day counting
  (excludes weekends & holidays), HR approval, balance/history/calendar, and email notifications.
- **Daily logs** — part-time activity logging (HR can review/edit all).
- **Overtime** — full-time submission with HR review.
- **Reimbursements** — submission with evidence upload and HR review.
- **Payroll** — monthly periods with live FX (USD→IDR) + HR override, per-employee preview
  (full-time salary/overtime/sick; part-time hours × rate), finalize + immutable payslip
  snapshots, and HTML payslip emails. Employees view their payslips.
- **Dashboards** — role-scoped: HR sees headcount, pending approvals, on-leave-today, upcoming
  holidays and payroll status; employees see their balance/hours, pending items, holidays and
  latest payslip.
- **Users admin** — HR manages accounts (create, role, active status, employee link, password reset).

## Structure

```
HRMS-Thesis/
├── server/                 # Express + TypeScript API (port 5000), Prisma ORM
│   ├── src/
│   │   ├── config/         # env, prisma client, mailer
│   │   ├── middleware/     # auth (JWT), rbac, validate (zod), errorHandler, upload
│   │   ├── lib/            # pure logic: workingDays, accrual, payroll, periodLock, fx, email
│   │   ├── modules/        # auth, users, employees, holidays, leave, daily-logs,
│   │   │                   #   overtime, reimbursements, payroll, dashboard (routes/controller/service/schemas)
│   │   ├── app.ts          # Express app (no listen) — imported by index.ts and tests
│   │   └── index.ts        # server entrypoint (listen + accrual catch-up)
│   ├── prisma/             # schema.prisma, migrations/, seed.ts
│   └── vitest.config.ts    # unit + API smoke tests
└── client/                 # Vite + React + TypeScript SPA (port 5173)
    └── src/{api,pages,layouts,components,lib}
```

pnpm workspaces monorepo.

## Prerequisites

- Node.js 20+ (tested on Node 24)
- pnpm 10+
- PostgreSQL 16 with a database named `hrms`

## Setup

1. Install dependencies (from the repo root):

   ```bash
   pnpm install
   ```

2. Configure the server environment. Copy the example and adjust if needed:

   ```bash
   cp server/.env.example server/.env
   ```

   The default `DATABASE_URL` targets `postgresql://postgres:postgres@localhost:5432/hrms`.

   **SMTP (email):** leave-request and payslip emails are sent via Nodemailer. To exercise the
   email scenarios, set real values in `server/.env`:

   ```
   SMTP_HOST=smtp.your-provider.com
   SMTP_PORT=587
   SMTP_USER=your-smtp-user
   SMTP_PASS=your-smtp-password
   SMTP_FROM="HRMS Aisahub <no-reply@aisahub.com>"
   ```

   Without valid SMTP, the app still works — email sends are logged and skipped (fire-and-forget).

3. Apply the database schema:

   ```bash
   pnpm prisma:migrate
   ```

4. Seed reference and sample data (idempotent — safe to re-run, resets demo data):

   ```bash
   pnpm prisma:seed
   ```

## Running

Build first, then run the API and web app separately.

```bash
pnpm build                       # builds both workspaces (tsc + vite)

# API — http://localhost:5000  (built entrypoint)
pnpm --filter server start

# Web — http://localhost:5173 (proxies /api → server)
pnpm --filter client dev
```

Health check: `GET http://localhost:5000/api/v1/health`.

## Build, lint & test

```bash
pnpm build       # builds both workspaces (tsc + vite)
pnpm lint:fix    # eslint --fix across both workspaces
pnpm test        # runs the server Vitest suite (unit + API smoke tests)
```

The server test suite covers the pure logic (working-day counting, leave accrual balance &
FIFO allocation, payroll math for both employment types) plus API smoke tests for auth and RBAC.
The API smoke tests run against the seeded database, so migrate + seed before running them.

## Default seed accounts

All accounts use the password `password123`.

| Email             | Role     | Type      | Notes                       |
| ----------------- | -------- | --------- | --------------------------- |
| hr@aisahub.com    | HR       | —         | HR administrator            |
| budi@aisahub.com  | EMPLOYEE | Full-time | Monthly salary Rp10,000,000 |
| sari@aisahub.com  | EMPLOYEE | Full-time | Monthly salary Rp12,000,000 |
| andi@aisahub.com  | EMPLOYEE | Part-time | Hourly rate Rp50,000        |
| dewi@aisahub.com  | EMPLOYEE | Part-time | Hourly rate Rp60,000        |

The seed also loads 2026 Indonesian national holidays and sample leave, overtime,
daily-log, reimbursement, and payroll records for UAT.

## User acceptance testing

Follow [`docs/uat-script.md`](docs/uat-script.md) — it maps the thesis UAT scenarios to concrete
click-paths using the seeded accounts, with a Status column for the tester.
