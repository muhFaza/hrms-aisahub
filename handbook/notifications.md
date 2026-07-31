# Notifications

In-app only. There is no email anywhere in this system — no SMTP, no nodemailer, no
`Payslip.emailSentAt`. Everything is delivered through the bell in the app header.

Email previously covered three events and missed two whole modules, dragged in an SMTP
dependency, and sent people links that only led back into the app anyway. Moving delivery
in-app made coverage uniform and removed an external dependency.

---

## The Core 7

Seven emitted events, and deliberately no others.

**HR receives:**

| Type | Trigger | Emitted from |
| --- | --- | --- |
| `LEAVE_SUBMITTED` | An employee records leave | `leave/service.ts` → `submitLeave` |
| `OVERTIME_SUBMITTED` | An employee logs overtime | `overtime/service.ts` → `createOvertime` |
| `REIMBURSEMENT_SUBMITTED` | An employee files a claim | `reimbursements/service.ts` → `createReimbursement` |
| `REQUEST_CANCELLED` | Any of the three is withdrawn | `cancelLeave`, `cancelOvertime`, `cancelReimbursement` |

`LEAVE_SUBMITTED` is informational rather than a queue item: leave takes effect on submit
and needs no HR action. It keeps its group key all the same, because the cancel path's
`resolveGroup` / `resolved > 0` gate depends on the group existing.

**The employee receives:**

| Type | Trigger | Emitted from |
| --- | --- | --- |
| `OVERTIME_DECIDED` | HR approves or rejects the entry | `overtime/service.ts` → `reviewOvertime` |
| `REIMBURSEMENT_DECIDED` | HR approves or rejects the claim | `reimbursements/service.ts` → `reviewReimbursement` |
| `PAYSLIP_AVAILABLE` | A payroll period is finalized | `payroll/service.ts` → `finalizePeriod` |

**`LEAVE_DECIDED` has no emitter.** Leave lost its approval step, so nothing writes this
type any more. The enum value and its entry in `notificationCopy.tsx` are **retained on
purpose** — production holds rows written before the change and they must keep rendering.
Do not remove either.

An employee with no user account — a profile-only record — receives nothing. That is not an
error and is not logged; the row simply has no recipient.

---

## Emission is awaited inside the transaction

This is the rule to internalise, and it is the opposite of what the old email code did.

Every `emit*` helper takes a Prisma transaction client as its **first argument**, so callers
inside `prisma.$transaction` pass `tx`:

```ts
await emitToEmployee(tx, decided.employeeId, { type: 'OVERTIME_DECIDED', ... });
```

The emails were fire-and-forget because SMTP is slow, external and failure-prone; awaiting
one would have coupled a request to a third party. A notification has none of those
properties. It is an `INSERT` on a connection the request already holds, so writing it in
the same transaction as the state change costs nothing and buys an invariant:

**A recorded leave request cannot exist without its notification, and a rolled-back
submission leaves no orphan notification.** For leave that boundary now also guards
money: `submitLeave` consumes paid-leave balance in the same transaction, so a failed
notification write unwinds the consumption too.

Two tests in `notifications.emit.test.ts` hold that boundary — one forces the notification
write itself to fail and asserts the submission and its balance consumption rolled back,
the other fails a write that happens *after* a successful emit and asserts the
notification went with it. Both use a
temporary database `CHECK` constraint rather than mocking, so they keep working regardless
of how `emit.ts` is written.

Any new emission site must take `tx`. An emission outside the transaction is a lie to the
recipient.

### Batching

`emitToEmployees` is the batched form: one recipient lookup and one `createMany` for a whole
set. `finalizePeriod` uses it because the per-row alternative held the finalize transaction
open for two extra queries per employee, unbounded in headcount — and this runs on a 1 GB
server.

---

## HR fan-out, group keys and auto-resolve

The three `*_SUBMITTED` events write **one row per active HR account**. Deactivated HR
accounts are skipped. All rows for one record share:

```
groupKey = "<ENTITY>:<id>"        e.g. "LEAVE_REQUEST:42"
```

When any HR reviews the record, or it is cancelled, the same transaction calls
`resolveGroup`, which stamps `resolvedAt` and `resolvedById` on every still-unresolved row
in that group and marks them read. Leave has no review, so a leave group stays unresolved
until the leave is cancelled — the cancellation notice therefore fires whenever an active
HR account existed at the moment the leave was recorded. The badge therefore counts work that is genuinely still
pending, rather than work a colleague already did an hour ago. The UI dims resolved rows and
shows "Handled by X".

`REQUEST_CANCELLED` fires **only when that resolve actually matched unresolved rows.**
`resolveGroup` returns the count and the caller checks it:

```ts
const resolved = await resolveGroup(tx, 'LEAVE_REQUEST', id, actor.userId);
if (resolved > 0) { await emitToHr(tx, { type: 'REQUEST_CANCELLED', ... }); }
```

There is no point telling HR that a request was withdrawn if they were never shown it in
the first place — a request submitted and cancelled before any HR account existed, for
instance.

---

## `entityId` is deliberately not a foreign key

Cancelling a request **hard-deletes the row**. There is no `CANCELLED` status; the record
ceases to exist. A foreign key would therefore either block the cancel or cascade the
notification away — and the `REQUEST_CANCELLED` notification is precisely the one that has
to outlive the record it describes.

So `entityId` stays a loose `Int`, and nothing assumes it still resolves. This is safe here
because the app has no per-record detail routes: a notification links to a list page, so a
dangling `entityId` is harmless.

`recipientId`, by contrast, is the one `User` foreign key in the schema that **cascades**. A
notification is a delivery record for one person, not audit trail, so it should die with the
account. It needs no reassignment when a user is deleted — unlike the four `SET NULL`
attribution columns described in [data-model.md](data-model.md), one of which is
`Notification.resolvedById`.

---

## Payloads — the client owns all copy

The server stores **structured data only**. No sentence a user reads is ever built in the
API. Adding or rewording a message needs no migration and no server deploy.

| Type | `payload` |
| --- | --- |
| `LEAVE_SUBMITTED` | `{ employeeName, leaveType, startDate, endDate, totalDays }` |
| `LEAVE_DECIDED` | `{ status, leaveType, startDate, endDate, totalDays, rejectReason }` — historical rows only |
| `OVERTIME_SUBMITTED` | `{ employeeName, date, hours }` |
| `OVERTIME_DECIDED` | `{ status, date, hours, rejectReason }` |
| `REIMBURSEMENT_SUBMITTED` | `{ employeeName, title, amount }` |
| `REIMBURSEMENT_DECIDED` | `{ status, title, amount, rejectReason }` |
| `PAYSLIP_AVAILABLE` | `{ year, month, totalIdr, totalUsd }` |
| `REQUEST_CANCELLED` | `{ employeeName, kind }` — `kind` is `LEAVE`/`OVERTIME`/`REIMBURSEMENT` |

Dates are ISO `YYYY-MM-DD` strings. Money is a `number`, matching the JSON convention
everywhere else. `title` on the reimbursement payloads is the model's `description` column
— the names differ.

`employeeName` can be `null`, so the render map guards it. `client/src/lib/notificationCopy.tsx`
maps `(type, payload)` to `{ title, description, link, icon }`, and an unrecognised type
renders a generic fallback rather than crashing — an older client must not break on a type
a newer server introduced.

Use `payload.kind`, not `entityType`, to route a `REQUEST_CANCELLED` deep link.

---

## Delivery

Three refresh triggers, all hitting `unread-count`:

1. a 30-second poll while the app is mounted
2. a refetch on route change
3. a manual sync button, on both the sidebar entry and the page

There is no websocket and no push — at this company's volume, polling one cheap indexed
count is the proportionate answer.

**Surfaces.** `/notifications` is the only place notifications are listed: a page with
pagination, an unread-only filter and "Mark all read", available to both roles. Two things
link to it, both showing the same unread badge — a bell in the `AppLayout` header, and a
`SidebarNotifications` entry pinned above the user block in the sidebar. The sidebar entry
carries a refresh button that invalidates the notification queries, so it works from any
page rather than only from the notifications page.

There was previously a `Drawer` behind the header bell holding its own copy of the list. It
was removed once the sidebar gained an entry: three routes to the same content, and two
unread badges on one screen, read as a bug. The bell is now a link.

Clicking a notification marks it read and navigates to the relevant list page.

---

## API

All four routes require auth, and **every query is scoped to `req.user.userId`.** There is
no path to another user's notifications.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/notifications` | `page`, `pageSize` (default 20, max 100), `unreadOnly` |
| GET | `/notifications/unread-count` | `{ count }` — no envelope |
| POST | `/notifications/read-all` | `{ updated }` |
| PATCH | `/notifications/:id/read` | Already-read is a 200 no-op |

Someone else's notification is a **404, not a 403** — the endpoint never confirms the id
exists. `/unread-count` and `/read-all` are registered before `/:id/read`, per the usual
static-before-parameterized rule.

`unreadOnly` is parsed as `z.enum(['true','false'])`, **not** `z.coerce.boolean()`. Coercion
applies JS truthiness, so the string `"false"` would arrive as `true` and pin the filter on
permanently. A route test asserts `?unreadOnly=false` still returns read rows; keep it.

**There is no create endpoint.** Notifications originate only from domain events.

---

## What is deliberately not notified

| Not notified | Why |
| --- | --- |
| Daily-log submissions | Volume. Part-timers log most working days; HR would learn to ignore the bell, which would cost them the events that matter. |
| Monthly accrual credits | Automatic, predictable, and visible on the balance page. Nobody needs telling they earned the day they earn every month. |
| User creation and role changes | Audit trail, not news. It belongs in a log, and HR performed the action themselves. |
| Period-lock warnings | The 409 at the point of the attempt already explains it, in context. |

Three further gaps, accepted rather than chosen:

- **HR deleting an employee's leave tells the employee nothing.** `cancelLeave` lets HR
  cancel anyone's record — including past-dated leave, as an override — and the row is
  deleted outright while the paid-leave balance is refunded. This predates notifications
  and is not made worse by them, but it is silent data loss from the employee's side.
  Worth a follow-up.
- **No retention or cleanup job.** Rows accumulate indefinitely. At this company's volume
  that is years away from mattering.
- **No per-user preferences.** Everyone gets every event for their role.
