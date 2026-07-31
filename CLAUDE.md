# CLAUDE.md

Guidance for Claude Code and other AI coding agents working in this repository.

## What this is

HRMS Aisahub — a Human Resource Management System for Aisahub Inc, built on the PERN stack
(PostgreSQL, Express, React, Node) entirely in TypeScript. It is the implementation for the
thesis *"Rancang Bangun Sistem Human Resource Management Menggunakan PERN Stack"*.

It handles employees, leave, overtime, reimbursements, part-time daily logs, holidays and
monthly payroll for a small Indonesian company. Two roles: HR and EMPLOYEE.

**This is real payroll software.** Its outputs are what people get paid. Treat correctness
in the leave and payroll paths as a higher bar than elsewhere.

## Layout

```
server/     Express + Prisma API (port 5000)
  src/config      env, prisma client
  src/middleware  auth, rbac, validate, errorHandler, upload
  src/lib         pure logic — workingDays, accrual, payroll, periodLock, fx
  src/modules     one folder per domain: routes / controller / service / schemas
  prisma          schema.prisma, migrations, seed.ts
client/     React 18 + Vite + Ant Design SPA (port 5173)
handbook/   reference documentation — read this before large changes
docs/       thesis design plan and UAT script (historical, not kept in sync)
```

pnpm workspaces. **Use `pnpm`, never `npm`.**

## Commands

```bash
pnpm install
pnpm prisma:migrate          # after editing schema.prisma
pnpm prisma:seed             # DESTRUCTIVE — wipes all tables first
pnpm --filter server dev     # API with watch
pnpm --filter client dev     # web app
pnpm lint:fix                # typecheck + lint, both workspaces
pnpm test                    # 113 server tests
```

There is no standalone typecheck script — `pnpm build` is the typecheck.

## Read before you change things

| Doing what | Read first |
| --- | --- |
| Anything touching leave or payroll | [handbook/domain-rules.md](handbook/domain-rules.md) |
| Anything touching auth, roles, or user accounts | [handbook/auth-and-roles.md](handbook/auth-and-roles.md) |
| Anything touching notifications | [handbook/notifications.md](handbook/notifications.md) |
| Schema or migration work | [handbook/data-model.md](handbook/data-model.md) |
| Adding an endpoint | [handbook/architecture.md](handbook/architecture.md), [handbook/api-reference.md](handbook/api-reference.md) |
| Adding a test | [handbook/testing.md](handbook/testing.md) |
| Setup, Docker, deployment, CI | [handbook/operations.md](handbook/operations.md) |
| Before reporting a bug you just found | [handbook/known-issues.md](handbook/known-issues.md) |

## Invariants — do not break these

**Authorization reads the database, not the token.** `middleware/auth.ts` takes only
`userId` from the JWT; `roleName` and `employeeId` are re-read from the user row on every
request. This was a real vulnerability that was fixed. Never "optimize" it back to reading
token claims.

**A user's role is fixed at creation.** `updateUserSchema` has no `roleId`, and this is
deliberate — accepting one reopens a staleness window. Changing a role means deactivate and
recreate. Do not add `roleId` to the update path.

**Dates that mean a calendar day are written at UTC midnight**, always:
`new Date(\`${iso}T00:00:00.000Z\`)`. Building a date from a local-time string shifts it a
day on any non-UTC machine and silently corrupts accrual periods, working-day counts and
period membership. Use the existing helpers.

**A finalized payroll month is frozen.** `assertPeriodEditable` guards create, update,
delete and review across leave, overtime, reimbursements and daily logs. Any new
dated-record mutation must call it.

**Business rules live in services, not controllers.** Controllers unwrap the request, call
the service, set the status. If a controller is growing logic, move it.

**`lib/` stays database-free.** That is what makes the payroll and accrual arithmetic
unit-testable.

## Conventions

- Zod validates every input; one `schemas.ts` per module. Use `z.coerce` for anything
  arriving as a string.
- Pagination is uniformly `page` / `pageSize` (default 20, max 100).
- Errors are thrown as `HttpError(status, message)` and mapped centrally.
- Money is `Decimal` in the database, `number` in JSON responses.
- Notifications are awaited *inside* the transaction that causes them. There is no email
  in this system. An `INSERT` on a connection the request already holds belongs in the same
  transaction as the state change — unlike an SMTP call, it is neither slow nor external —
  so an approved request can never exist without its notification.
- Employees and users are deactivated, never deleted.
- Register static routes before parameterized ones (`/leave/balance` before `/leave/:id`).

## Testing

**Do not use test-driven development.** Implement first, then propose tests for review, then
run them.

The suite runs against an isolated `hrms_test` database that is created and migrated
automatically — it never touches development data. `psql` must be on `PATH`.

Route-level tests catch things service tests structurally cannot. **Any new HR-only
capability needs a route test**, not just a service test.

When asserting that something was rejected, assert on the **stored state**, not just the
status code — Zod strips unknown keys silently, so a 200 does not prove a field was ignored.

## Deleting a User

Never a plain `DELETE`. Five foreign keys are `ON DELETE SET NULL`, so deleting a user
silently strips the approver from approved leave, overtime and reimbursements, and the
finalizer from finalized payroll periods — destroying audit trail on a payroll system
without raising an error.

Reassign those four columns first. `prisma/migrations/20260730120000_remove_seeded_owner_account`
is the reference implementation.

`Notification.recipientId` is the one `User` foreign key that cascades, deliberately: a
notification is a delivery record for one person, not audit trail, so it dies with the
account and needs no reassignment. (`Notification.resolvedById` is `SET NULL`.)

## Things that look wrong but are intentional

- `docs/plans/` is out of date in places. It is a historical design record, not a spec.
  Discrepancies are catalogued in [handbook/domain-rules.md](handbook/domain-rules.md).
- The seed opens with `deleteMany()` across every table. That is by design; it is why
  container entrypoints guard it with an emptiness check.
- Test factories use bcrypt cost 4. The application uses 10.
- `fileParallelism: false` in the vitest config is load-bearing — every file shares one
  database and truncates between tests.
- `cors()` has no options. Auth is a bearer header rather than a cookie, and production
  serves the SPA from the same origin, so there is no ambient authority to abuse.

## Git

Do not commit or push unless explicitly asked. Do not merge anything without being told to.

Conventional commit messages: `feat(scope):`, `fix(scope):`, `test(scope):`, `chore(scope):`.
