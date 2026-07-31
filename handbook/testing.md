# Testing

**104 tests across 10 files, all server-side.** The client has no test tooling at all.

```bash
pnpm --filter server test
```

Runs in about 4 seconds against a dedicated `hrms_test` database.

---

## Test database isolation

The suite truncates tables between tests, so it must never touch your development database.
It doesn't:

1. `TEST_DATABASE_URL`, if set, is used verbatim — the CI and custom-database escape hatch.
2. Otherwise `DATABASE_URL` is parsed and `_test` is appended to the database name:
   `…/hrms` becomes `…/hrms_test`.
3. A name already ending in `_test` is returned unchanged, so the derivation is idempotent.
4. If neither variable is set, it throws with an explicit message rather than guessing.

`globalSetup` then creates that database if it is missing and runs `prisma migrate deploy`
against it — `deploy`, not `dev`, so there are no drift prompts and no shadow database.

**`psql` must be on your `PATH`.** It is the one undocumented external dependency, used to
issue the `CREATE DATABASE` (which cannot run inside its own target). If it is missing, the
failure message tells you to `createdb` manually.

`TEST_DATABASE_URL` is not in `.env.example`. Set it explicitly when you need a different
target:

```bash
TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/hrms_ci?schema=public" \
  pnpm --filter server test
```

---

## Vitest configuration

| Setting | Why |
| --- | --- |
| `setupFiles` | Runs per test file **before its module graph is imported** — the only point at which `DATABASE_URL` can be redirected before `config/prisma.ts` constructs its client |
| `globalSetup` | Runs once per run, in a separate context: create the database, apply migrations |
| `fileParallelism: false` | **Critical.** Every file shares one physical database and truncates in `beforeEach`. Concurrent files would truncate each other's rows mid-test |
| `testTimeout: 20000` | Database round-trips per test |
| `hookTimeout: 60000` | The one-off `migrate deploy` runs inside a hook on a cold database |

`setupEnv.ts` used to force `SMTP_HOST=''` as a guard against a suite opening a real SMTP
connection. That is gone with the email system: notifications are plain rows in the test
database, so suites assert on `prisma.notification` directly and there is nothing left to
mock.

---

## Fixtures

`server/src/__tests__/helpers/factories.ts`. Suites build the exact rows they assert on
rather than depending on `prisma/seed.ts` — so a run is reproducible on a clean checkout,
and a failure points at data defined a few lines above the assertion.

| Helper | Notes |
| --- | --- |
| `resetDb()` | Queries `pg_tables`, excludes `_prisma_migrations`, one `TRUNCATE … RESTART IDENTITY CASCADE`. No hand-maintained FK ordering, so it survives schema growth |
| `createRole(name)` | Upsert — safe after a truncate |
| `createEmployee(opts?)` | Defaults to full-time, active, `joinDate` 2026-01-01, salary 10,000,000 |
| `createUser(opts?)` | Defaults to EMPLOYEE, no employee link. Returns the user with `role` included |
| `createEmployeeWithUser(opts?)` | The common case — returns `{ employee, user }` |
| `signToken(user, overrides?)` | Mirrors what the login service signs. `overrides` is how expiry is tested: `{ expiresIn: '-1s' }` |
| `authUser(user)` | Builds the `req.user` object for **direct service calls**, bypassing HTTP |
| `bearer(token)` | For `.set(...bearer(t))` |
| `createAccrual(opts)` | `period` / `expiresAt` are ISO date **strings**, converted internally |
| `createLeaveRequest(opts)` | `totalDays` is **required and not computed** — see pitfalls |
| `createHoliday(date, name?)` | Always `NATIONAL` |
| `finalizePeriod(year, month, by)` | The way to exercise period-lock 409s |
| `utc(isoDate)` | `T00:00:00.000Z`. Use this rather than constructing dates by hand |

Factory users hash at bcrypt cost 4 — cost 10 is roughly 100ms each and would dominate the
run. **The application still uses cost 10.**

---

## What is covered

| File | Tests | Area |
| --- | --- | --- |
| `__tests__/api.smoke.test.ts` | 10 | Full-stack: health, login paths, identical 401s, deactivated account, 403s, JSON 404 |
| `lib/__tests__/accrualMath.test.ts` | 5 | Pure accrual maths — expiry, balance, FIFO allocation. No database |
| `lib/__tests__/payroll.test.ts` | 7 | Pure payslip computation, both employment types. No database |
| `lib/__tests__/workingDays.test.ts` | 6 | Pure day counting, including holiday-on-weekend. No database |
| `middleware/__tests__/auth.test.ts` | 14 | Header shape, signature and expiry, deactivation, and the database-over-token claims |
| `middleware/__tests__/rbac.test.ts` | 7 | `requireRole` invoked directly. No database |
| `modules/leave/__tests__/leave.routes.test.ts` | 13 | Leave through the full middleware chain |
| `modules/leave/__tests__/leave.service.test.ts` | 32 | The deep suite — submit, FIFO consumption, cancel window, refund, scoping |
| `modules/payroll/__tests__/payroll.service.test.ts` | 1 | Sick leave reaches the payslip on dates alone, with no status column |
| `modules/users/__tests__/users.routes.test.ts` | 9 | Access, role-fixed-at-creation, demotion takes effect immediately |

The auth, rbac and users tests are the regression tests for the two authorization fixes on
this branch. Treat them as a pair with the fixes — they exist to stop those bugs returning.

**Not covered:** the employees, holidays, daily-logs, overtime, reimbursements and
dashboard modules; payroll beyond the one sick-leave case; file upload and download; path
traversal. There is no
coverage threshold configured.

---

## Running

```bash
pnpm --filter server test                                    # everything
pnpm --filter server test src/middleware/__tests__/auth.test.ts
pnpm --filter server exec vitest run auth.test               # substring match on path
pnpm --filter server exec vitest run -t "takes roleName from the database"
pnpm --filter server exec vitest                             # watch mode
```

`-t` matches the concatenated `describe` + `it` names, so `-t "requireRole"` selects a whole
block.

---

## Adding a test

**1. Choose the level.** The leave module deliberately has one of each:

| Level | Example | Catches | Misses |
| --- | --- | --- | --- |
| Pure | `lib/__tests__/workingDays.test.ts` | Arithmetic errors | Everything else |
| Service | `leave.service.test.ts` | Business-rule bugs | A missing `requireRole` |
| Route | `leave.routes.test.ts` | The whole middleware chain | — |

**Direct service tests structurally cannot see a missing route guard.** Any new HR-only
capability needs a route-level test, not just a service test. That is the entire reason
`leave.routes.test.ts` exists.

**2. The standard preamble.** Import `app` from `../../../app` — never `index.ts`, which
calls `listen()`.

```ts
beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

Truncate in `beforeEach`, not `afterEach`, so a failing test leaves its rows behind for
inspection. **Every database-backed file needs the `$disconnect`** or vitest hangs on open
handles.

**3. Build data with factories**, not `prisma.*.create` and not the seed.

**4. Authenticate.** Route tests use `.set(...bearer(signToken(user)))`. A real login
round-trip is only needed when login itself is under test. Service tests pass
`authUser(user)`, and edge cases are forged by spreading:
`{ ...authUser(user), employeeId: 999_999 }`.

**5. Freeze time** whenever anything derives from "now" — accruals are generated from
`joinDate` through the current month, so real time makes balances drift:

```ts
const NOW = new Date('2026-07-15T12:00:00.000Z');

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });   // Date ONLY
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  await resetDb();
});

afterEach(() => {
  vi.useRealTimers();
});
```

**`toFake: ['Date']` is mandatory.** Faking `setTimeout`/`setInterval` too would stall
Prisma's async I/O and the suite would hang.

**6. Assert notifications against the database**, not against a mock. Emission writes rows
in the same transaction as the change, so `prisma.notification.findMany()` after the call
is the whole assertion. Nothing needs stubbing.

**7. Assert on state, not just status.** For route tests, add a database re-read proving
nothing changed:

```ts
expect(res.status).toBe(403);
const after = await prisma.user.findUnique({ where: { id }, include: { role: true } });
expect(after?.role.name).toBe('EMPLOYEE');
```

A 200 does not prove a field was rejected — Zod strips unknown keys silently.

---

## Pitfalls

- **UTC dates everywhere.** Construct with `utc('2026-07-06')`. Any local-time construction
  shifts the day and silently breaks weekend and holiday logic.
- **July 2026 is the shared reference calendar**: 6th Mon, 8th Wed, 10th Fri, 11th Sat,
  12th Sun, 13th Mon, 17th Fri. Reuse it rather than inventing dates.
- **`createLeaveRequest` requires `totalDays` explicitly.** The factory does not compute it
  from the range. An inconsistent value creates a row the service would never have produced,
  and your balance assertions then test fiction.
- **`createLeaveRequest` writes the row directly and consumes no accrual**, unlike
  `submitLeave`. To assert on a refund, either submit through the service or set
  `daysConsumed` on the accrual yourself.
- **The leave suite pins "now" to 2026-07-15**, and the cancel window is judged against it:
  a fixture starting on the 14th is already past, one starting on the 20th is not.
- **Employment type gates the fixtures.** A daily-log test needs `PART_TIME` or the service
  403s; overtime needs `FULL_TIME`. And `joinDate` drives how many accrual days exist — the
  leave suite sets `joinDate: utc('2026-05-10')` against a July "now" precisely to get 3.
- **`createEmployee` versus `createEmployeeWithUser`** decides whether anyone can be
  notified. A bare `createEmployee` has no account, so employee-directed emission is a
  silent no-op — that is the fixture for the "skips it" branch, and an accidental one in a
  test that meant to assert a notification exists.
- **Never re-enable parallelism** without giving each file its own database or schema.
- **`RESTART IDENTITY` makes ids restart at 1**, so `id: 1` assertions *appear* to work.
  Don't rely on it — capture the returned row's id.
