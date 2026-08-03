# API reference

Base path for everything: **`/api/v1`**. 52 endpoints across eleven modules.

Authentication is a bearer token: `Authorization: Bearer <jwt>`. Every route except
`POST /auth/login` and `GET /health` requires one.

"Role" below means what the *server* enforces, not what the UI shows.

---

## Health

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | public | `{status, timestamp}` |

## `auth`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/login` | public | Email + password → JWT and user shape |
| GET | `/auth/me` | any | Current user plus linked employee |
| POST | `/auth/password` | any | Change your own password |

Login returns a deliberately generic *"Invalid email or password"* for both an unknown
email and a wrong password, so account existence does not leak. A deactivated account gets
a distinct message, but only **after** the password check passes.

`POST /auth/password` takes `{currentPassword, newPassword}` and acts on `req.user.userId`
— there is no id in the path, so it cannot be pointed at another account. It lives in
`auth` rather than `users` because every `/users` route is HR-only, and this is the one
password path an employee owns. HR's reset (`PATCH /users/:id`) is separate and needs no
current password.

A wrong current password returns **400, not 401** — deliberately. The client's axios
interceptor treats any 401 outside `/auth/login` as an expired session and redirects to the
login page, so a 401 here would sign the user out over a typo.

Neither path invalidates existing sessions: there is no revocation list, so tokens already
issued stay valid until they expire. Both UIs say so at the point of change. Deactivating
the account remains the only immediate revocation.

## `users` — the entire router is HR-only

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/users` | HR | All accounts with role and employee name |
| GET | `/users/roles` | HR | Role options for the form |
| POST | `/users` | HR | Create an account |
| PATCH | `/users/:id` | HR | Toggle active, reset password, relink employee |

**`roleId` is not accepted by PATCH.** A user's role is fixed when the account is created;
changing it requires deactivating and recreating. HR also cannot deactivate their own
account.

## `employees`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/employees` | HR | Paginated list; search / employmentType / status filters |
| POST | `/employees` | HR | Create |
| GET | `/employees/:id` | HR **or** own record | Detail |
| PUT | `/employees/:id` | HR | Full replace |
| POST | `/employees/:id/contract` | HR | Upload contract (multipart field `file`) |
| GET | `/employees/:id/contract` | HR **or** own record | Download the contract |

Self-access is enforced in the controller, not the router. `PUT` is a genuine full replace —
any optional field you omit is set to `null`. Full-time requires `monthlySalary`, part-time
requires `hourlyRate`, and KTP must be exactly 16 digits.

`fullTimeSince` is the exception to the full-replace rule: **omit it and the server derives
it** from the `employmentType` transition rather than nulling it — becoming full-time anchors
accrual at today, leaving full-time clears it, and an update that does not change employment
type preserves the stored value. Supply it explicitly to correct a conversion recorded late.
A part-time employee never carries an anchor, whatever the body says.

There is no delete and no `isActive`. Employment ends through
`POST /employees/:id/terminate`, which records an effective date and a reason;
`POST /employees/:id/rehire` opens a fresh employment for somebody who has left. Both are
HR-only. The employee payload carries a derived `status` (`ACTIVE` / `TERMINATED`), a
`terminationDate`, and `employments[]` — the full history, newest first. The flat
`contractStartDate` / `contractEndDate` / `contractFilePath` / `fullTimeSince` fields are the
**current** employment's, kept flat so existing clients did not have to change.

## `holidays`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/holidays` | any | List, optional `?year=` |
| POST | `/holidays` | HR | Create |
| PUT | `/holidays/:id` | HR | Update |
| DELETE | `/holidays/:id` | HR | Hard delete |

Dates are normalized to UTC midnight so they match the `YYYY-MM-DD` keys used by
working-day counting. `Holiday.date` is unique, so a duplicate returns 409.

## `leave`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/leave/balance` | any (HR must pass `?employeeId=`) | Accrual breakdown for one employee |
| GET | `/leave/balances` | HR | One balance row per active full-timer |
| GET | `/leave/calendar` | any | `?month=YYYY-MM` → leave + holidays |
| GET | `/leave` | any, self-scoped | Paginated records, `?type=PAID\|SICK\|UNPAID` |
| POST | `/leave` | full-time employees only | Record leave — takes effect immediately |
| DELETE | `/leave/:id` | owner **or** HR | Cancel, refunding paid days |

There is no review route: leave has no approval step, and no `status` column to filter on.
`POST` consumes paid-leave balance in the same transaction that writes the row, so it
returns 400 if the balance cannot cover it.

`POST` returns 400 for a **part-time** employee whatever the type — leave is a full-time-only
feature. `DELETE` is deliberately not gated that way, so HR can still unwind a historical
record belonging to someone who has since converted.

`SICK` and `UNPAID` neither check nor consume the balance, and neither refunds on cancel.
Both produce a payroll deduction; `GET /leave/balance` reports them as the independent
lifetime totals `sickTaken` and `unpaidTaken`.

`DELETE` deletes the row and refunds a PAID record's days, unwinding non-expired accrual
rows first in FIFO order and expired ones only after. An employee may
cancel only up to and including the leave's first day (400 afterwards); **HR is exempt from
that window** and may cancel past-dated leave. Nobody is exempt from the finalized-month
lock (409).

Non-HR callers are hard-scoped to their own `employeeId`; an `employeeId` query filter from
an employee is ignored, not honoured.

## `daily-logs`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/daily-logs` | any, self-scoped; HR sees all | Paginated, `?month=YYYY-MM` |
| POST | `/daily-logs` | PART_TIME only | Log a day's hours |
| PUT | `/daily-logs/:id` | owner **or** HR | Edit |
| DELETE | `/daily-logs/:id` | owner **or** HR | Delete |

No `requireRole` appears in this router — all authorization lives in the service. Editing a
log that moves it to a different date checks the payroll lock on **both** dates.

## `overtime`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/overtime` | any, self-scoped | Paginated, `?status=` |
| POST | `/overtime` | FULL_TIME only | Submit |
| PATCH | `/overtime/:id/review` | HR | Approve or reject |
| DELETE | `/overtime/:id` | **owner only** | Cancel PENDING |

At most one PENDING-or-APPROVED entry per employee per date, enforced in the service (409).

## `reimbursements`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/reimbursements` | any, self-scoped | Paginated, `?status=` |
| POST | `/reimbursements` | any with an employee link | Submit + **required** evidence file |
| GET | `/reimbursements/:id/evidence` | owner **or** HR | Download evidence |
| PATCH | `/reimbursements/:id/review` | HR | Approve or reject |
| DELETE | `/reimbursements/:id` | **owner only** | Cancel PENDING and unlink the file |

Ordering matters on create: the upload middleware runs **before** validation, so that
multer populates the multipart text fields first. That is why the schema uses `z.coerce` on
`date` and `amount`.

## `payroll`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/payroll/my-payslips` | any | Own finalized payslips |
| GET | `/payroll/periods` | HR | List periods with payslip counts |
| POST | `/payroll/periods` | HR | Create a DRAFT with an optional custom date pair; omitted dates default to 26–25; fetch the live rate |
| GET | `/payroll/periods/:id` | HR | Preview — computed live for DRAFT, read from snapshots for FINALIZED |
| PATCH | `/payroll/periods/:id` | HR | Override the exchange rate and/or both dates while DRAFT |
| POST | `/payroll/periods/:id/finalize` | HR | Snapshot payslips, notify every employee, lock the stored range |
| DELETE | `/payroll/periods/:id` | HR | Delete a DRAFT period |
| GET | `/payroll/periods/:id/export/pdf` | HR | Payroll sheet PDF for the period |
| GET | `/payroll/periods/:id/export/csv` | HR | Payment-gateway payout file |
| GET | `/payroll/payslips/:id/export/pdf` | any | Payslip PDF — own, or any if HR |

`/my-payslips` is registered before `/periods/:id` so it is not swallowed by the parameter
route. Rate/range updates and delete return 409 unless the period is DRAFT. Date pairs must
be ordered, complete, and non-overlapping; malformed pairs return 400 and overlaps return 409.

### Exports

All three return a `Content-Disposition: attachment` body rather than JSON, and **409 unless
the period is FINALIZED** — a draft is recomputed on every read, so putting its figures on a
payment file would be publishing a number the next request could contradict.

The payslip route is the one export any employee may call. It answers **404, not 403,** for a
payslip belonging to someone else: a 403 would confirm the payslip exists, which turns the
endpoint into a headcount oracle. The identical 404 is returned for an id that does not exist.

The CSV omits any employee whose net is zero or negative — no gateway can action that payout.
It carries `X-Export-Included` and `X-Export-Excluded` headers so the caller can report the
omission instead of leaving the row count silently disagreeing with the PDF sheet.

Because auth is a bearer header and not a cookie, these cannot be fetched with a plain
`<a href download>`. The client routes every download through the axios instance with
`responseType: 'blob'` (`client/src/lib/download.ts`).

## `dashboard`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/dashboard` | any | Role-shaped aggregate — the controller branches on role |

One endpoint, two response shapes. An employee with no linked profile gets a zeroed shape
rather than an error.

## `notifications`

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/notifications` | any | Own notifications, newest first. `unreadOnly` plus the usual `page`/`pageSize` |
| GET | `/notifications/unread-count` | any | `{ count }` — what the header bell badge polls |
| POST | `/notifications/read-all` | any | Mark every unread one read, returns `{ updated }` |
| PATCH | `/notifications/:id/read` | any | Mark one read; already-read is a 200 no-op |

**There is no create endpoint.** Notifications are written only by the domain services, in
the same transaction as the event that caused them — see
[notifications.md](notifications.md).

Every query is scoped to `req.user.userId`, so someone else's notification is a **404**,
not a 403: the endpoint never confirms the id exists. `/unread-count` and `/read-all` are
registered before `/:id/read`.

A row carries `type`, `entityType`, `entityId`, a type-specific `payload`, `readAt`,
`resolvedAt` and a flattened `resolvedByName` for the "Handled by …" line. `entityId` is
deliberately not a foreign key — cancelling a request hard-deletes it, and the
"this was cancelled" notification has to outlive the record it describes, so the client
never assumes the target still resolves.

---

## Conventions

**Pagination** — `page` (default 1) and `pageSize` (default 20, max 100) on every list
endpoint.

**Errors** — `{ error: string }`, plus `details: [{path, message}]` for validation failures.
Status codes: 400 validation, 401 auth, 403 role or ownership, 404 missing, 409 conflict
(duplicate, overlapping payroll range, or a finalized payroll period).

**Uploads** — 5 MB cap, MIME allowlist of PDF / JPEG / PNG. Two endpoints accept files:
employee contracts (field `file`) and reimbursement evidence (field `evidence`). Uploaded
files are **not** served statically — they are reachable only through the two authenticated
download endpoints above.

**Locked ranges** — once a payroll period is FINALIZED, any create, edit, review or cancel
touching a record dated inside its stored range returns a 409 naming the labeled period and
its Start/End dates.
