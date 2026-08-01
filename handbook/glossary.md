# Glossary

Two kinds of jargon collide in this project: Indonesian employment law and web development.
This page explains both in plain language. It exists mainly for
[AGENTS.md](../AGENTS.md) readers, but the HR terms trip up developers too.

---

## Indonesian HR terms

**Cuti** — leave, in the sense of time off work. *Cuti tahunan* is annual leave.

**Cuti bersama** — literally "joint leave". Days the Indonesian government designates as
collective days off, usually bridging a public holiday and a weekend around Eid or Lunar
New Year. In this system they are holidays of type `JOINT_LEAVE` — and, unlike every other
holiday type here, **they are working days**. Employees work them, so leave taken across a
cuti bersama consumes that day and a sick day falling on one is deducted.

**THR — Tunjangan Hari Raya** — a religious-holiday allowance that Indonesian employers are
legally required to pay before a major religious holiday, typically equivalent to one
month's salary for employees with a year or more of service. The database records who is
eligible (`Employee.thrEligible`, true for the full-timers in the seed data).

**Lembur** — overtime.

**KTP — Kartu Tanda Penduduk** — the Indonesian national identity card. Its number is
exactly 16 digits, which is why the employee form rejects anything else.

**IDR / Rp — Indonesian Rupiah**, the currency. Amounts look large because roughly 16,000
rupiah is one US dollar — a salary of Rp 10,000,000 per month is about USD 625.

**PPh / BPJS** — Indonesian income tax and national insurance. Referenced in the thesis
design but **not implemented**: this system does not calculate tax or insurance
deductions.

---

## Roles in this system

**HR** — the administrator. Sees everyone, approves everything, runs payroll, manages
accounts.

**EMPLOYEE** — sees only their own records. Cannot see anyone else's leave, pay, or
personal details.

There are only these two. A person's role is fixed when their account is created and
cannot be edited afterwards — changing it means deactivating the account and making a new
one.

**Full-time vs part-time** is a separate axis from role, and it changes what an employee
can do:

| | Full-time | Part-time |
| --- | --- | --- |
| Paid by | Monthly salary | Hourly rate × hours logged |
| Earns paid leave | Yes | No |
| Can claim overtime | Yes | No |
| Logs daily activity | No | Yes |

---

## Concepts specific to this app

**Accrual** — the way paid leave is earned. Rather than granting a lump of days each year,
this system credits a fraction each month and each credit expires on its own schedule.
Every credit is a row in the database.

**FIFO consumption** — "first in, first out". When someone takes paid leave, the system
spends their oldest-expiring credits first, so nothing expires unused while newer credits
sit unspent.

**Payroll period** — one month's payroll run. It starts as a **draft**, where numbers are
recalculated live every time you look at it and can still change. **Finalizing** it freezes
everything: payslips are written permanently, and every leave request, overtime entry,
reimbursement and daily log dated in that month becomes read-only. This is deliberate — you
cannot pay someone and then retroactively change what they were paid for.

**Payslip** — the frozen record of what one person was paid for one month. Created only
when a period is finalized. Never edited afterwards.

**Exchange rate / FX** — payslips show a US dollar total alongside the rupiah figure. The
rate is fetched from a public API when the payroll period is created. If that fails, a
fallback rate is used and the app says so, so someone can correct it before finalizing.
The label on each period tells you where the rate came from: `API` (live), `FALLBACK`
(the API failed), or `MANUAL` (a person typed it in).

**Working days** — days that count as leave. Weekends and holidays are excluded. Asking for
Friday through Monday over a normal weekend costs two days of balance, not four.

**Notification** — a message in the app, reached from the sidebar or the bell in the top
bar. There is no email in this system: when something happens that concerns you, it appears
there and nowhere else. HR is told when someone records leave or submits or withdraws a
request; an employee is told when their overtime or reimbursement is decided and when a new
payslip is ready. Leave is never "decided", so there is no notification for that.

**Unread** — a notification you have not opened yet. The number on the bell counts these.
Opening one, or pressing "Mark all read", clears it. Nothing is ever deleted — read
notifications stay in the list.

**Fan-out** — one event producing a copy for several people. When an employee submits a
leave request, every HR account gets its own notification, because any of them might be the
one to deal with it.

**Group key** — the label that ties those copies together, so the system knows they are all
about the same request.

**Resolved / handled** — what happens to the whole group the moment one HR person acts. If
three HR accounts were told about an overtime entry and one approves it, all three
notifications are marked handled and stop counting as unread — the other two are not being
asked to do a job that is already done. The list shows them dimmed, with "Handled by" and
the name of whoever did it. Leave has no approval step, so a leave group is resolved only
if the leave is cancelled.

**Seed / seeding** — filling an empty database with sample data for demos and testing:
five accounts, four employees, the 2026 Indonesian holiday calendar, and a handful of
example requests. **Seeding erases everything in the database first.**

---

## Technical terms

**API / backend / server** — the part with no visible interface. It holds the rules and
talks to the database. Everything the app is *allowed* to do is decided here.

**Frontend / client / SPA** — the part you see in the browser. It is only a display layer;
it never decides who is allowed to do what.

**Database / PostgreSQL** — where the data is stored permanently.

**Prisma** — the tool the server uses to talk to the database, and the thing that defines
the shape of every table.

**Migration** — one recorded change to the database's structure, or occasionally to its
contents. They run in order, and each runs exactly once per database, so a fresh database
and a two-year-old one end up identically shaped. **Migrations are forward-only here —
there is no undo.**

**Schema** — the definition of what tables exist and what columns they have.

**JWT / token** — the pass the browser gets at login and presents with every subsequent
request. It expires after 12 hours, after which you log in again.

**Endpoint / route** — one specific address the frontend can call, such as
"give me my leave balance".

**Environment variable** — a setting supplied from outside the code: database address,
email server, secret keys. They differ between a laptop and the live server, which is why
they are not written into the code.

**Docker / container** — a way of packaging the app with everything it needs so it runs the
same everywhere. **Compose** runs several containers together — here, the app and its
database.

**Deploy** — putting a new version onto the live server.

**CI / GitHub Actions** — the robot that runs the tests automatically whenever code is
proposed, and blocks the change if they fail.

**Repository / repo** — the project's folder, with its full history.

**Branch** — a parallel copy of the project where changes are made safely, without touching
the working version.

**PR / pull request** — a proposal to merge a branch's changes in, with a place to review
and discuss them first.

**Commit** — one saved change, with a message explaining it.

**Merge** — accepting a branch's changes into the main version.

**Lint / linting** — automated style and error checking.

**Test suite** — the automated checks that prove the rules still work. This project has 142
of them, all covering the server.
