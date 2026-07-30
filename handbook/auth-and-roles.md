# Authentication and roles

Who can do what, and how the system enforces it.

---

## The one thing to understand

**Only `userId` comes from the token. Everything else is re-read from the database on every
single request.**

`server/src/middleware/auth.ts` verifies the bearer token, then immediately looks up the
user row and takes `roleName` and `employeeId` from *that*, not from the token's claims.

This is not incidental. It means:

- A token forged with `roleName: 'HR'` — even one signed with the real secret — gains
  nothing.
- A tampered `employeeId` claim is discarded, so it cannot re-scope every "own records
  only" query to somebody else's data.
- Deactivating or deleting an account revokes an otherwise-valid 12-hour token
  **immediately**, rather than at expiry.
- A role changed directly in the database takes effect on the next request.

The lookup is free: the `isActive` check needed that row anyway.

The token payload still *carries* `roleName` and `employeeId`, but only for debugging. Do
not read them.

Every one of these properties has a regression test in
`server/src/middleware/__tests__/auth.test.ts`.

---

## Request flow

1. Header must exist and start with `Bearer ` → else 401 *"Missing or invalid Authorization
   header"*.
2. `jwt.verify` — any failure (bad signature, malformed, expired) collapses to a single 401
   *"Invalid or expired token"*, so nothing about *why* leaks.
3. Database lookup. Missing row or `isActive === false` → 401 *"Account is inactive or no
   longer exists"*.
4. `req.user = { userId, roleName, employeeId }`, with `employeeId` normalized to `null`
   rather than `undefined` — downstream code branches on `null`.

`/api/v1/auth` is the only router mounted without `authenticate`. `GET /api/v1/health` is
the only other public route.

---

## Role gating

`requireRole(...roles)` — fifteen lines in `server/src/middleware/rbac.ts`.

| Condition | Result |
| --- | --- |
| No `req.user` | 401 *"Authentication required"* |
| Role not in the list | 403 *"Insufficient permissions"* |
| Otherwise | `next()` |

Matching is exact and **case-sensitive** — `'hr'` does not satisfy `requireRole('HR')`.
`requireRole()` with no arguments denies everyone.

401 is checked before 403 deliberately: returning 403 to an anonymous caller would confirm
the route exists for someone.

---

## Login

`POST /api/v1/auth/login` is the only public write route. There is **no self-registration
anywhere** — HR is the only path to an account.

- Passwords are bcrypt (cost 10 in the application; the test factories use cost 4 for
  speed).
- An unknown email and a wrong password return the **same** 401, so account existence does
  not leak.
- A deactivated account gets a distinct message, but only *after* the password check passes
  — so that message is unreachable without valid credentials.
- Tokens are HS256, lifetime from `JWT_EXPIRES_IN` (default 12h). `JWT_SECRET` is required
  at boot; the process refuses to start without it.
- There is **no refresh token and no revocation list.** Revocation is the per-request
  `isActive` lookup.
- The login response contains no `passwordHash`, no `isActive`, no `roleId`.

---

## Accounts and the role rule

Every route under `/users` is HR-only, applied router-wide rather than per-route — so a new
route added below inherits the guard automatically.

**A user's role is fixed when the account is created and cannot be changed.**

`updateUserSchema` accepts only `isActive`, `password` and `employeeId`. `roleId` is
deliberately absent, and the service never touches it. The documented migration path for a
role change is: deactivate the account, create a new one.

Two behaviours worth knowing, both tested:

| Request | Result |
| --- | --- |
| `PATCH { roleId }` alone | **400** — Zod strips the unknown key, leaving an empty object, and the "at least one field" refinement fires |
| `PATCH { isActive: false, roleId }` | **200** — `roleId` is silently stripped, `isActive` applies, role unchanged |

Because the second case succeeds, the test asserts on the *stored role*, not the status
code. Copy that habit: a 200 does not prove the field was rejected.

**Deactivation:** HR cannot deactivate their own account. That is a lock-out guard, not a
complete one — nothing stops the last two HR users deactivating each other.

**Employee linking:** `employeeId` is nullable. Omitting the key leaves the link alone;
sending an explicit `null` clears it. HR accounts typically have no employee link, which is
why so much of the codebase must handle "no employee profile".

---

## Capability matrix

"Own" means scoped to the caller's `employeeId`. Route-level denials are 403; "no linked
employee profile" is 400, except on list endpoints which return an empty page.

| Action | HR | EMPLOYEE |
| --- | --- | --- |
| Log in, read own session | yes | yes |
| Health check | public | public |
| **Users** | | |
| List users / roles, create user | yes | **403** |
| Update user (active, password, employee link) | yes, except own deactivation → 400 | **403** |
| Change a user's role | **no such capability** | **no such capability** |
| **Employees** | | |
| List / search employees | yes | **403** |
| Create / update employee, upload contract | yes | **403** |
| View employee by id | any | **own only** |
| Download contract | any | **own only** |
| **Holidays** | | |
| List holidays | yes | yes — all rows |
| Create / update / delete holiday | yes | **403** |
| **Leave** | | |
| List leave requests | all; optional employee filter | **own only** — a supplied filter is ignored |
| Submit leave request | 400, no profile | own, implicitly |
| Approve / reject | yes | **403** |
| Cancel a pending request | **any employee's** | own only |
| Read a leave balance | any, but `?employeeId=` **required** (400 without) | own only; query ignored |
| Read all balances | yes | **403** |
| Read leave calendar | company-wide | **company-wide — not scoped** |
| **Daily logs** | | |
| List | all; optional filter | own only |
| Create | 400, no profile | own, and **part-time only** |
| Edit / delete | **any** | own only |
| **Overtime** | | |
| List | all; optional filter | own only |
| Submit | 400, no profile | own, and **full-time only** |
| Approve / reject | yes | **403** |
| Cancel | **403 — no HR exemption** | own only |
| **Reimbursements** | | |
| List | all; optional filter | own only |
| Submit (evidence required) | 400, no profile | own |
| Download evidence | any | own only |
| Approve / reject | yes | **403** |
| Cancel | **403 — no HR exemption** | own only |
| **Payroll** | | |
| List / create / preview / rate / finalize / delete periods | yes | **403** |
| Read own payslips | yes, but returns `[]` | own, finalized periods only |
| **Dashboard** | | |
| Dashboard | HR variant, org-wide | employee variant, own |

### Three asymmetries that look like bugs

1. **HR can delete another employee's pending leave request and their daily logs, but
   cannot cancel their overtime or reimbursement.** Those two services omit the
   `roleName !== 'HR' &&` prefix, so HR — whose `employeeId` is `null` — fails the equality
   check and gets 403.
2. **The leave calendar is the one read endpoint with no scoping at all.** Any authenticated
   employee sees every approved leave request company-wide, with names. Presumably
   intentional for a shared team calendar, but you cannot tell that from the route file.
3. **HR must pass `?employeeId=` to read a single balance**, returning 400 rather than
   defaulting — because HR has no employee profile of their own.

Orthogonal to role, several actions are additionally gated by **employment type**
(part-time-only daily logs, full-time-only overtime and paid leave) and by the **payroll
period lock**.

---

## How ownership scoping is enforced

There is no ORM row-level filter and no policy layer. Scoping is hand-written in three
places.

**1. List endpoints — in the service `where` clause.** The shape is uniform:

```ts
if (actor.roleName === 'HR') {
  if (query.employeeId) where.employeeId = query.employeeId;
} else {
  // Employees only ever see their own requests, ignoring any employeeId filter.
  if (!actor.employeeId) return { data: [], total: 0, page, pageSize };
  where.employeeId = actor.employeeId;
}
```

The employee branch **overwrites** rather than merges, so a hostile `?employeeId=` is
silently ignored rather than rejected.

**2. Single-record reads and mutations — in the service, after fetching the row.** Fetch by
id → 404 if missing → compare against `actor.employeeId` → 403. Note that 404 comes before
403, so a probing employee can distinguish "does not exist" from "not yours".

**3. The employees module — in the controller.** The only module that scopes at the
controller layer, via `assertCanView`.

**Creation paths never trust a client-supplied `employeeId`** — they read `actor.employeeId`
and return 400 if it is null. That is the payoff of the design at the top of this page:
`actor.employeeId` came from the database *this request*, not from a token issued hours ago.

File downloads add a second layer, calling `path.basename()` on the stored filename before
joining it to the upload directory, to defeat traversal from a poisoned database value.

---

## Error mapping

| Thrown | Response |
| --- | --- |
| `ZodError` | 400 `{ error: 'Validation failed', details: [{path, message}] }` |
| `HttpError` | its own status |
| Prisma `P2002` / `P2003` | 409 |
| Prisma `P2025` | 404 |
| Other known Prisma codes | 400 |
| Anything else | 500, logged |
