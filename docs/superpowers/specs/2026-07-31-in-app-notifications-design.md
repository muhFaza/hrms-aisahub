# In-app notifications — design

**Date:** 2026-07-31
**Branch:** `feat/in-app-notifications`
**Status:** approved, implementing

## Goal

Remove every email notification from HRMS Aisahub and replace it with in-app
notifications delivered through a bell in the app header.

## Why

Email today covers only three events and misses two whole modules. It also drags in an
SMTP dependency, a nodemailer package and a `Payslip.emailSentAt` column, all for
notifications that nobody can act on from their inbox anyway — every link would send them
back into the app. Moving the notifications into the app makes coverage uniform and
deletes an external dependency.

## What email does today (all of it)

| Trigger | Recipient | Code |
| --- | --- | --- |
| Leave submitted | every active HR | `server/src/lib/email.ts:48`, called from `leave/service.ts` |
| Leave approved/rejected | the requester | `server/src/lib/email.ts:138`, called from `leave/service.ts` |
| Payroll finalized | each employee | `server/src/lib/email.ts:94`, called from `payroll/service.ts` |

Overtime, reimbursements, daily logs and user management notify nobody.

## Event catalog — the Core 8

**Employee receives:**

| ID | Type | Emitted from |
| --- | --- | --- |
| E1 | `LEAVE_DECIDED` | `leave/service.ts` → `reviewLeave` |
| E2 | `OVERTIME_DECIDED` | `overtime/service.ts` → `reviewOvertime` |
| E3 | `REIMBURSEMENT_DECIDED` | `reimbursements/service.ts` → `reviewReimbursement` |
| E4 | `PAYSLIP_AVAILABLE` | `payroll/service.ts` → `finalizePeriod` |

**HR receives:**

| ID | Type | Emitted from |
| --- | --- | --- |
| H1 | `LEAVE_SUBMITTED` | `leave/service.ts` → `submitLeave` |
| H2 | `OVERTIME_SUBMITTED` | `overtime/service.ts` → `createOvertime` |
| H3 | `REIMBURSEMENT_SUBMITTED` | `reimbursements/service.ts` → `createReimbursement` |
| H4 | `REQUEST_CANCELLED` | `cancelLeave`, `cancelOvertime`, `cancelReimbursement` |

Explicitly out of scope: daily-log submissions (volume), accrual credits, user-creation
audit trail, period-lock warnings, and notifying an employee that HR deleted their pending
request (see Known gaps).

## Data model

```prisma
enum NotificationType {
  LEAVE_SUBMITTED
  LEAVE_DECIDED
  OVERTIME_SUBMITTED
  OVERTIME_DECIDED
  REIMBURSEMENT_SUBMITTED
  REIMBURSEMENT_DECIDED
  PAYSLIP_AVAILABLE
  REQUEST_CANCELLED
}

model Notification {
  id           Int              @id @default(autoincrement())
  recipientId  Int
  recipient    User             @relation("NotificationRecipient", fields: [recipientId], references: [id], onDelete: Cascade)
  type         NotificationType
  entityType   String
  entityId     Int
  payload      Json
  groupKey     String?
  readAt       DateTime?
  resolvedAt   DateTime?
  resolvedById Int?
  resolvedBy   User?            @relation("NotificationResolver", fields: [resolvedById], references: [id], onDelete: SetNull)
  createdAt    DateTime         @default(now())

  @@index([recipientId, readAt])
  @@index([recipientId, createdAt])
  @@index([groupKey])
}
```

### `entityId` is deliberately not a foreign key

`cancelLeave` (`leave/service.ts:239`) hard-deletes the row — there is no `CANCELLED`
status, the record ceases to exist. `cancelOvertime` and `cancelReimbursement` do the
same. A foreign key would either block the cancel or cascade the notification away, and
the H4 "this was cancelled" notification specifically needs to outlive the record it
describes. The column stays a loose `Int` and the client never assumes the target
resolves.

### Cascade on recipient

`onDelete: Cascade` is correct here and is a deliberate exception to the pattern the five
other `User` foreign keys follow. Those are `ON DELETE SET NULL` because they hold audit
trail (approvers, finalizers) that must survive. A notification holds no audit value —
it is a delivery record for one person, and it should die with that account.

This adds a sixth `User` foreign key, so `CLAUDE.md`'s "Deleting a User" section needs a
line saying notifications cascade and require no reassignment.

## Emission

New module `server/src/modules/notifications/`. **Not** in `lib/` — the "`lib/` stays
database-free" invariant rules that out, since emission reads the HR recipient list and
writes rows.

```
server/src/modules/notifications/
  emit.ts         emitToHr(), emitToEmployee(), resolveGroup() — all accept a tx client
  service.ts      list, unreadCount, markRead, markAllRead
  controller.ts
  routes.ts
  schemas.ts
```

### Emissions are awaited inside the existing transaction

This is a deliberate departure from the "Emails are fire-and-forget; nothing in a request
path awaits SMTP" convention. That convention exists because SMTP is a slow, failure-prone
external dependency. A notification is an INSERT on a connection we already hold. Writing
it inside the same transaction as the state change means an approved leave request can
never exist without its notification, and a rolled-back review leaves no orphan.

Every `emit*` helper takes a Prisma transaction client as its first argument so callers
inside `prisma.$transaction` pass `tx`.

### HR fan-out and auto-resolve

H1–H3 write one row per active HR user, all sharing `groupKey = "<ENTITY>:<id>"`.

When any HR acts (`review*`) or the record is cancelled (`cancel*`), the same transaction
resolves every unresolved notification with that `groupKey`: sets `resolvedAt`,
`resolvedById`, and `readAt` if still null. The bell then reflects work that is genuinely
still pending.

H4 is emitted **only when the resolve actually matched unresolved rows** — there is no
point telling HR about a request they were never shown.

## Payload shapes

Client owns all copy. The server stores structured data only.

| Type | payload |
| --- | --- |
| `LEAVE_SUBMITTED` | `{ employeeName, leaveType, startDate, endDate, totalDays }` |
| `LEAVE_DECIDED` | `{ status, leaveType, startDate, endDate, totalDays, rejectReason }` |
| `OVERTIME_SUBMITTED` | `{ employeeName, date, hours }` |
| `OVERTIME_DECIDED` | `{ status, date, hours, rejectReason }` |
| `REIMBURSEMENT_SUBMITTED` | `{ employeeName, title, amount }` |
| `REIMBURSEMENT_DECIDED` | `{ status, title, amount, rejectReason }` |
| `PAYSLIP_AVAILABLE` | `{ year, month, totalIdr, totalUsd }` |
| `REQUEST_CANCELLED` | `{ employeeName, kind }` where kind is LEAVE/OVERTIME/REIMBURSEMENT |

Dates are ISO date strings. Money is `number`, matching the existing JSON convention.

## API

All routes require auth. Every query is scoped to `req.user.userId`; there is no path to
another user's notifications. Static routes registered before parameterized ones, per
repo convention.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/notifications` | `page`, `pageSize` (default 20, max 100), `unreadOnly` |
| GET | `/api/notifications/unread-count` | `{ count: number }` |
| POST | `/api/notifications/read-all` | marks all of the caller's unread as read |
| PATCH | `/api/notifications/:id/read` | 404 if the row is not the caller's |

There is no create endpoint. Notifications originate only from domain events.

List item response:

```json
{
  "id": 12,
  "type": "LEAVE_DECIDED",
  "entityType": "LEAVE_REQUEST",
  "entityId": 42,
  "payload": { "status": "REJECTED", "...": "..." },
  "readAt": null,
  "resolvedAt": null,
  "resolvedByName": null,
  "createdAt": "2026-07-31T04:10:00.000Z"
}
```

`resolvedByName` is the resolver's full name, flattened for display ("Handled by …").

## Client

### Delivery

Three refresh triggers, all hitting `unread-count`:

1. 30-second poll while the app is mounted
2. refetch on route change
3. a manual sync button, present on both the sidebar and the notifications page

The sidebar and page refetch the full list on open and on manual sync.

### Surfaces

- **Bell** in `AppLayout` header with an unread badge.
- **Sidebar** — an Ant Design `Drawer` from the right. Latest 10, unread emphasized,
  resolved items dimmed with "Handled by X". Footer links: "Mark all read", "View all".
- **Page** — `/notifications`, paginated table/list, `unreadOnly` filter, sync button,
  "Mark all read". Route is available to both roles.

### Deep links

There are no per-record detail routes in this app, so a notification links to the relevant
list page and nothing more. This also means a dangling `entityId` is harmless.

| Type | Link |
| --- | --- |
| `LEAVE_SUBMITTED`, `REQUEST_CANCELLED` (leave) | `/leave` |
| `OVERTIME_SUBMITTED`, `REQUEST_CANCELLED` (overtime) | `/overtime` |
| `REIMBURSEMENT_SUBMITTED`, `REQUEST_CANCELLED` (reimbursement) | `/reimbursements` |
| `LEAVE_DECIDED` | `/my-leave` |
| `OVERTIME_DECIDED` | `/my-overtime` |
| `REIMBURSEMENT_DECIDED` | `/my-reimbursements` |
| `PAYSLIP_AVAILABLE` | `/my-payslips` |

Clicking marks the notification read and navigates.

### Copy rendering

One render map keyed by `NotificationType`, in `client/src/lib/notificationCopy.tsx`,
turning `(type, payload)` into `{ title, description, link, icon }`. An unrecognised type
renders a generic fallback rather than crashing.

## Email teardown

Full removal:

- delete `server/src/lib/email.ts` and `server/src/config/mailer.ts`
- drop `nodemailer` and `@types/nodemailer` from `server/package.json`
- remove the `smtp` block from `server/src/config/env.ts`, the `SMTP_*` lines from
  `server/.env.example` and `.env.docker.example`, and the `SMTP_HOST` line from
  `server/src/__tests__/helpers/setupEnv.ts`
- drop `Payslip.emailSentAt` via migration
- `client/src/api/payroll.ts` loses `emailSentAt`; `MyPayslipsPage`'s "Email sent" column
  is removed (the payslip's existence is now signalled by the notification)
- remove the email assertions from the existing leave tests

Dropping `emailSentAt` is destructive against the live VPS database. The deploy for this
branch needs a database backup taken first — that is a release step, not a code step.

## Testing

Following repo convention: implement first, then tests.

- **Service tests** — emission on each of the 8 events; fan-out writes one row per active
  HR and skips inactive ones; auto-resolve stamps siblings; H4 only fires when something
  was actually resolved; rollback leaves no notification.
- **Route tests** — the four endpoints; a user cannot read or mark another user's
  notification (assert on stored state, not just status code, per CLAUDE.md); pagination
  bounds.
- Existing leave tests lose their email assertions and gain notification ones.

## Known gaps, accepted for this pass

- **HR can delete an employee's pending request and the employee is told nothing.** The
  guard at `leave/service.ts:245` lets HR cancel anyone's request, and the row is deleted
  outright. This predates the change and is not made worse by it, but it is silent data
  loss from the employee's side. Worth a follow-up.
- No notification retention or cleanup job. Rows accumulate indefinitely. At this
  company's volume that is years away from mattering.
- No per-user notification preferences. Everyone gets all events for their role.
