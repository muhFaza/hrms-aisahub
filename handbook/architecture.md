# Architecture

A pnpm workspace monorepo with two packages: `server/` (Express + Prisma API) and
`client/` (React SPA). One database. No message queue, no cache, no background worker.

```
Browser
  │  fetch /api/v1/... with  Authorization: Bearer <jwt>
  ▼
Express app  (server/src/app.ts)
  │  cors → json → urlencoded → authenticate → requireRole → validate → controller
  ▼
Service layer      ← business rules, Prisma access, Decimal→number serialization
  │
  ├── lib/         ← pure functions: working days, accrual math, payslip math
  ▼
PostgreSQL (Prisma)
```

In production the same Express process also serves the built React app, so there is one
origin and no CORS. In development the Vite dev server on `:5173` proxies `/api` to the API
on `:5000`.

---

## Request lifecycle

The order in `server/src/app.ts` is deliberate at several points:

1. **`GET /api/v1/health`** is registered before any auth and is the only unauthenticated
   route besides login.
2. **`/auth` mounts bare**; the other nine routers are each mounted *behind* `authenticate`
   at the `app.use` call site. Routers therefore assume `req.user` exists — you will not
   find an auth check inside them.
3. **`authenticate`** (`server/src/middleware/auth.ts`) verifies the JWT, then re-reads the
   user row from the database. Role and employee link come from that row, never from token
   claims. See [auth-and-roles.md](auth-and-roles.md) — this is the security-critical part
   of the system.
4. **`requireRole(...)`** → **`validate({body, query, params})`** → **`asyncHandler(controller)`**.
   `validate` *replaces* `req.body`/`req.query`/`req.params` with the Zod-parsed value, so
   downstream code sees coerced types rather than strings.
5. **`notFoundHandler`** then **`errorHandler`**, registered last.

`app.ts` exports the app without calling `listen`; only `server/src/index.ts` listens. That
split exists so `supertest` can import the app directly in tests.

On boot, `index.ts` fires `ensureAccrualsUpToDate()` without awaiting it, so leave balances
self-heal at startup. Failures only log.

---

## The four layers

| Layer | Holds | Does not hold |
| --- | --- | --- |
| **Routes** (`routes.ts`) | Path, role gate, validation schema, handler wiring | Logic |
| **Controllers** (`controller.ts`) | Unwrap the request, call the service, set the status. Ownership checks that need `req` | Business rules |
| **Services** (`service.ts`) | Business rules, invariants, all Prisma access, `Decimal` → `number` conversion | HTTP concepts |
| **Lib** (`lib/`) | Pure functions with no database access | Anything I/O |

Controllers are 11–60 lines. Anything longer belongs in the service.

The `lib/` boundary is the one that earns its keep: `countWorkingDays`, the accrual maths
and `computePayslipRow` are pure functions, which is why they can be unit-tested with no
database and why the payroll arithmetic is verifiable in isolation.

---

## Module layout

Every domain under `server/src/modules/` follows the same four-file shape:

```
modules/<domain>/
  routes.ts       paths, role gates, validation
  controller.ts   thin HTTP adapter
  service.ts      the actual behaviour
  schemas.ts      Zod input schemas
```

Eleven modules: `auth`, `users`, `employees`, `holidays`, `leave`, `daily-logs`, `overtime`,
`reimbursements`, `payroll`, `dashboard`, `notifications`. (`dashboard` has no `schemas.ts`
— it takes no input.) Full endpoint list in [api-reference.md](api-reference.md).

`notifications` carries a fifth file, `emit.ts`: the write side, called by the other
modules rather than by a route. Nothing creates a notification over HTTP — they originate
only from domain events.

**Adding a domain?** Copy the shape. Mount the router behind `authenticate` in `app.ts`,
register static routes before parameterized ones (`/leave/balance` must precede
`/leave/:id`), and put invariants in the service, not the controller.

---

## Shared libraries — `server/src/lib/`

| File | Purpose |
| --- | --- |
| `httpError.ts` | `HttpError(status, message, details?)` — the app's single error currency |
| `asyncHandler.ts` | Wraps async handlers so rejections reach the error handler. Express 4 does not catch promise rejections on its own |
| `workingDays.ts` | `countWorkingDays` — pure, UTC, inclusive of both endpoints, excludes weekends and holidays |
| `accrual.ts` | Leave accrual: pure maths (`computeBalance`, `planFifoAllocation`) plus the database-touching `ensureAccrualsUpToDate` / `getBalanceBreakdown` |
| `payroll.ts` | `computePayslipRow` — deliberately database-free |
| `periodLock.ts` | `assertPeriodEditable(date)` — throws 409 if that month's payroll is finalized |
| `fx.ts` | The one external HTTP call — USD→IDR, 5s timeout, returns `null` on every failure mode |

Notification emission is deliberately **not** here: it reads the HR recipient list and
writes rows, so it lives in `modules/notifications/emit.ts` rather than break the
database-free rule.

`periodLock` is worth internalising: it is called from leave review/cancel, daily-log
create/update/delete, overtime create/review/cancel and reimbursement
create/review/cancel. Finalizing a payroll month freezes every record dated in it.

---

## Error handling

`server/src/middleware/errorHandler.ts` is a four-branch cascade:

| Thrown | Response |
| --- | --- |
| `ZodError` | 400 with `details[]` of `{path, message}` |
| `HttpError` | its own status and message |
| Prisma `P2002`/`P2003` | 409 |
| Prisma `P2025` | 404 |
| Other known Prisma errors | 400 with the code |
| `PrismaClientValidationError` | 400 |
| anything else | logged, bare 500 |

**Known gap:** `MulterError` matches no branch, so an over-5MB upload surfaces as a generic
500 rather than a 400. See [known-issues.md](known-issues.md).

---

## Conventions worth matching

- **Zod for every input.** One `schemas.ts` per module. Use `z.coerce` wherever a value
  arrives as a string (query parameters, multipart fields).
- **Pagination** is uniformly `page` (default 1) and `pageSize` (default 20, max 100).
- **Money is `Decimal` in the database**, converted to `number` in services for JSON.
- **Dates that mean "a calendar day" are written at UTC midnight**, always. This is the
  single most common source of bugs here — see [data-model.md](data-model.md#gotchas).
- **Notifications are awaited inside the transaction that causes them.** The opposite of
  the fire-and-forget rule the SMTP emails followed, and for the reason that rule existed:
  a notification is an `INSERT` on a connection the request already holds, not a call to a
  slow external service. Writing it in the same transaction as the state change means an
  approved leave request can never exist without its notification, and a rolled-back review
  leaves no orphan. Every `emit*` helper takes the transaction client as its first argument.
- **Soft delete over hard delete** for employees and users (`isActive`).

---

## Frontend shape

React 18 + Vite + Ant Design + TanStack Query. One axios instance with two interceptors —
one attaching the bearer token, one redirecting to `/login` on any 401 except a failed
login. Server state lives in TanStack Query; there is no Redux/Zustand layer. The only
React context is `AuthContext`.

Details in [frontend.md](frontend.md).

---

## What is deliberately absent

No refresh tokens (12-hour JWT, then log in again). No caching layer. No background job
runner — accrual catch-up runs at boot and on demand. No file storage service; uploads go
to a local directory served only through authenticated download endpoints. No
observability stack beyond `console`.

For a thesis project running for one company on a 1 GB server, each of these is a
reasonable omission rather than an oversight.
