# HRMS Implementation Plan

Design reference: `docs/plans/2026-07-08-hrms-design.md` (authoritative for schema, business rules, API, pages).

Verification at every phase checkpoint: `pnpm build` in both `server/` and `client/` must pass (no dev server). Lint via `pnpm lint:fix`. Tests are written after implementation and run at phase checkpoints (no TDD).

Environment: Node 24, pnpm 10, PostgreSQL 16 at `postgresql://postgres:postgres@localhost:5432/hrms` (database created). Windows.

## Phase 1 — Foundation
Monorepo scaffold (pnpm workspaces), `server/` Express+TS app with config/middleware skeleton and health endpoint, `client/` Vite+React+TS with AntD + Router + TanStack Query shell, complete Prisma schema per design §3, initial migration applied to local DB, seed script (roles, HR user, Owner user, 2 full-time + 2 part-time employees with linked users, 2026 Indonesian national holidays, sample transactional data), root scripts (`build`, `lint:fix`), `.env` + `.env.example`, `.gitignore`.

## Phase 2 — Auth, RBAC, Users, Employees
`POST /auth/login` (bcrypt + JWT), `GET /auth/me`, auth + role middleware, users module (HR manages accounts), employees module (CRUD + contract file upload via multer, served behind auth). Client: login page, AuthContext + route guards, AppLayout with role-gated nav, Employees pages (HR), Profile page (employee).

## Phase 3 — Holidays & Leave
Holidays CRUD (HR) + holiday calendar view. Leave: accrual engine (1 day/month, 18-month expiry, idempotent catch-up, FIFO consumption on approval with restore on rejection), working-day calculator (skips weekends + holidays), request submission (PAID gated on balance & full-time; SICK any employee), HR review (approve/reject), balance/history endpoints, leave calendar (who's off per date), email notifications (Nodemailer: to HR-role accounts on submission, to requester on decision). Client: leave pages for both roles + calendar.

## Phase 4 — Daily Logs, Overtime, Reimbursements
Daily logs (part-time submit/edit own, HR view/edit all), overtime (full-time submit, HR review), reimbursements (any employee submit with evidence upload, HR review). Client pages per role. Records in a FINALIZED payroll period are locked.

## Phase 5 — Payroll
FX fetch (open.er-api.com USD→IDR, fallback manual), period creation (DRAFT), preview computation per design §4 (full-time vs part-time), rate edit, finalize (lock + snapshot payslips + email HTML payslip per employee), my-payslips endpoint. Client: HR payroll pages (period list, preview table, finalize confirm), employee payslip page.

## Phase 6 — Dashboards, Tests, UAT
Role-scoped `GET /dashboard` + dashboard pages. Vitest unit tests: working-day calc, accrual/expiry/FIFO, payroll math (both types). Supertest smoke: login, RBAC 403 for employee on payroll admin. UAT script doc mapping thesis Table 2.1 scenarios to click-paths (`docs/uat-script.md`). Final full build + lint.
