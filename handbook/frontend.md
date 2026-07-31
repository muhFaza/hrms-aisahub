# Frontend

`client/` — React 18, Vite, TypeScript, Ant Design 5, TanStack Query 5, React Router 6,
axios. No Redux or Zustand: server state lives in TanStack Query, and the only React
context is `AuthContext`.

Dev server on `:5173`, proxying `/api` to `http://localhost:5000`. That proxy is why the
axios `baseURL` is the *relative* `/api/v1` — which in turn is what lets one origin serve
both halves in production.

---

## Provider stack

`client/src/main.tsx`:

```
QueryClientProvider → ConfigProvider (AntD theme) → AntApp → BrowserRouter → AuthProvider → App
```

The `QueryClient` is created with no global defaults — no `staleTime`, no retry policy.

Theme: primary `#0F766E` (teal), layout background `#F5F7FA`, 8px radius, Inter Variable.
`src/index.css` adds a box-sizing reset and a 180ms page fade that respects
`prefers-reduced-motion`.

---

## Routes

`client/src/App.tsx` — one public route plus a guarded layout route.

| Path | Page | Guard |
| --- | --- | --- |
| `/login` | `LoginPage` | public; bounces to `/dashboard` if already signed in |
| `/dashboard` | `DashboardPage` | auth — branches on role internally |
| `/employees`, `/employees/:id` | Employees list / detail | HR |
| `/leave` | `LeaveReviewPage` | HR |
| `/holidays` | `HolidaysPage` | **auth only** — HR gets a CRUD table, employees a read-only view |
| `/daily-logs` | `DailyLogsReviewPage` | HR |
| `/overtime` | `OvertimeReviewPage` | HR |
| `/reimbursements` | `ReimbursementsReviewPage` | HR |
| `/payroll`, `/payroll/:id` | Payroll periods / detail | HR |
| `/users` | `UsersPage` | HR |
| `/my-leave` | `MyLeavePage` | auth |
| `/my-daily-log` | `MyDailyLogPage` | auth — menu link only for part-timers |
| `/my-overtime` | `MyOvertimePage` | auth — menu link only for full-timers |
| `/my-reimbursements`, `/my-payslips`, `/profile` | employee pages | auth |
| `*` | → `/dashboard` | auth |

Two notes worth carrying: the `/my-*` routes have **no role guard** — they are
employee-facing by menu construction only, and server-side scoping is what actually
protects the data. And `src/pages/PlaceholderPage.tsx` is dead code, imported nowhere.

---

## Authentication

| Concern | How |
| --- | --- |
| Storage | `localStorage['token']` |
| Attaching | An axios request interceptor sets `Authorization: Bearer <token>` on every call |
| Session restore | On mount, if a token exists, `GET /auth/me`. Success populates context; failure drops the token. A `loading` flag gates rendering |
| 401 handling | A response interceptor clears the token and does a hard `window.location.assign('/login')` — for every URL **except** `/auth/login`, which passes through so the form can show the server's message |
| Route guards | `RequireAuth` shows a spinner while loading, then redirects. `RequireRole` renders a 403 page rather than redirecting — deliberate, so UAT can see the refusal |

The 401 redirect is a full page reload, which wipes the React Query cache. That is
intentional: it guarantees no stale authorized data survives a session ending.

There is no refresh-token flow and no client-side expiry check. A 12-hour token simply
stops working and the next request bounces the user to login.

---

## `src/api/` — data layer

One file per domain, each exporting TanStack Query hooks. Query keys and invalidation:

| File | Keys | Invalidated by |
| --- | --- | --- |
| `dashboard.ts` | `['dashboard','hr']`, `['dashboard','employee']` | **nothing — see below** |
| `employees.ts` | `['employees', params]`, `['employee', id]` | create / update / contract upload |
| `leave.ts` | `['leave', params]`, `['leave-balance', id]`, `['leave-balances']`, `['leave-calendar', month]` | submit / review / cancel each invalidate all four |
| `overtime.ts` | `['overtime', params]` | submit / review / cancel |
| `reimbursements.ts` | `['reimbursements', params]` | submit / review / cancel |
| `dailyLogs.ts` | `['daily-logs', params]` | create / update / delete |
| `holidays.ts` | `['holidays', year]` | create / update / delete |
| `payroll.ts` | `['payroll-periods']`, `['payroll-preview', id]`, `['my-payslips']` | create / rate / finalize / delete invalidate the first two only |
| `users.ts` | `['users']`, `['roles']` | create / update |

Both dashboard hooks hit the same `GET /dashboard`; the server shapes the response by role
and the page enables exactly one.

**Two staleness bugs live in this table** — the dashboard queries are never invalidated by
anything, and `['my-payslips']` is not invalidated by finalize. Both are recorded in
[known-issues.md](known-issues.md).

File downloads (`downloadContract`, `downloadEvidence`) fetch a blob and trigger a
synthetic `<a download>` click, so they carry the auth header rather than relying on a
public URL.

---

## Navigation

`layouts/AppLayout.tsx` builds the sidebar **per role and per employment type**:

- **HR** — Dashboard, Employees, Leave, Holidays, Daily Logs, Overtime, Reimbursements,
  Payroll, Users
- **Employee** — Dashboard, My Leave, Holidays, then **Daily Log** only if part-time and
  **Overtime** only if full-time, then Reimbursements, My Payslips, Profile

Collapsible 232px sider with the brand block at the top and avatar, role tag and **Log out**
pinned to the bottom.

---

## Pages at a glance

**Employees** — list with search and employment-type filter; detail view; a 640px form
drawer with five sections (Personal, Employment, Contract, Payment, Education & Social).
The salary field swaps between **Monthly Salary (IDR)** and **Hourly Rate (IDR)** as the
employment type changes, and the payload nulls whichever one does not apply. Contract
upload is edit-mode only — the form says so explicitly.

**Users** — table plus a create/edit modal. On edit, Email disappears, password becomes an
optional reset, and **Role is visible but disabled** with the note *"Role cannot be changed
after the account is created."*

**Leave** — employees get tabs **My Leave** / **Calendar** with four stat cards and an
expiring-soon alert. HR gets **Requests** / **Balances** / **Calendar**, and the reject
modal keeps its confirm button disabled until a reason is typed.

**Overtime / Reimbursements / Daily logs** — the same submit-modal plus review-table shape.
The reimbursement upload uses `beforeUpload={() => false}` so the file is held and sent in
the FormData rather than uploaded separately.

**Payroll** — the periods table, a create modal explaining the FX behaviour, then a detail
page. DRAFT shows an editable rate, **Save rate**, **Delete** and **Finalize**; FINALIZED
replaces them with a lock line. Every payslip row expands into a plain-language breakdown.
The finalize confirmation spells out all three consequences and that it cannot be undone.

**Payslips** — period, IDR total, USD total, with the same expandable breakdown. There is
no delivery column: a finalized payslip announces itself through a `PAYSLIP_AVAILABLE`
notification, which shows up on the unread badge and on `/notifications`.

---

## Tooling

Scripts: `dev`, `build` (`tsc -b && vite build`), `preview`, `lint:fix`.

**There is no test script — the client has no frontend test tooling at all.** All automated
testing in this repository is server-side. See [testing.md](testing.md).
