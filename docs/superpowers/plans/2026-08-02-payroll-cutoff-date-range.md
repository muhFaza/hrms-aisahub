# Payroll Cutoff Date Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable payroll Start Period and End Period dates that default to the previous month's 26th through the selected month's 25th and drive payroll calculation, finalization, exports, and record locking.

**Architecture:** Store an inclusive date range on `PayrollPeriod` and make it the only source of payroll boundaries. Extend the existing payroll create/PATCH API and existing payroll React pages, then refactor the database-free payroll arithmetic and shared period lock to accept those stored boundaries. Preserve all legacy periods as calendar-month ranges during migration so historical behavior cannot shift silently.

**Tech Stack:** PostgreSQL, Prisma 6, Express 4, Zod 3, TypeScript 5, React 18, TanStack Query 5, Ant Design 5, Day.js, Vitest 4, Supertest

## Global Constraints

- New periods default to inclusive 26th-of-previous-month through 25th-of-selected-month boundaries, including December-to-January rollover.
- HR may edit both dates at creation and while a period is DRAFT; FINALIZED ranges are immutable.
- Start Period must be on or before End Period, and no payroll ranges may overlap.
- The stored range drives every included record, employment overlap, proration, attendance figure, export, and finalized-record lock.
- Existing periods retain their original first-to-last-calendar-day ranges during migration; no stored Payslip is changed.
- Keep Year and Month as the label and existing unique key.
- Use UTC-midnight conversions for calendar days.
- Reuse existing payroll modules and UI pages; add no dependency and no new production service or component file.
- Do not touch the user's existing `client/src/pages/daily-logs/DailyLogModal.tsx` changes or unrelated untracked files.
- Follow the repository's implementation-first workflow: change production code before adding/updating tests. Do not use TDD.
- Do not commit, push, merge, seed, edit `.env`, or touch a live database without separate explicit authorization.

---

### Task 1: Persist and constrain payroll ranges

**Files:**
- Modify: `server/prisma/schema.prisma:260`
- Create: `server/prisma/migrations/20260802193000_add_payroll_period_range/migration.sql`
- Modify: `server/prisma/seed.ts:331`
- Modify: `server/src/__tests__/helpers/factories.ts:242`
- Modify: all direct PayrollPeriod fixtures listed by `rg -l "payrollPeriod\.create" server/src server/prisma/seed.ts`

**Interfaces:**
- Consumes: existing `PayrollPeriod.year`/`month` labels and UTC calendar-day convention.
- Produces: required Prisma fields `startDate: Date` and `endDate: Date`, backed by PostgreSQL `DATE`, with inclusive non-overlap and ordering constraints.

- [ ] **Step 1: Add the Prisma fields**

Add the two required fields beside Year and Month:

```prisma
model PayrollPeriod {
  id            Int           @id @default(autoincrement())
  year          Int
  month         Int
  startDate     DateTime      @db.Date
  endDate       DateTime      @db.Date
  exchangeRate  Decimal       @db.Decimal(15, 4)
  // existing fields unchanged
}
```

- [ ] **Step 2: Add the migration with legacy-safe backfill**

Create the migration manually so its backfill and unsupported exclusion constraint remain explicit:

```sql
ALTER TABLE "PayrollPeriod"
  ADD COLUMN "startDate" DATE,
  ADD COLUMN "endDate" DATE;

UPDATE "PayrollPeriod"
SET
  "startDate" = make_date("year", "month", 1),
  "endDate" = (make_date("year", "month", 1) + INTERVAL '1 month - 1 day')::date;

ALTER TABLE "PayrollPeriod"
  ALTER COLUMN "startDate" SET NOT NULL,
  ALTER COLUMN "endDate" SET NOT NULL;

ALTER TABLE "PayrollPeriod"
  ADD CONSTRAINT "PayrollPeriod_range_order"
  CHECK ("startDate" <= "endDate");

ALTER TABLE "PayrollPeriod"
  ADD CONSTRAINT "PayrollPeriod_range_no_overlap"
  EXCLUDE USING gist (daterange("startDate", "endDate", '[]') WITH &&);
```

The exclusion constraint uses PostgreSQL's native `daterange` GiST operator and therefore needs no new extension.

- [ ] **Step 3: Update seed and fixture construction**

Add a reusable calendar-boundary helper to test factories:

```ts
export function calendarPeriodRange(year: number, month: number) {
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1)),
    endDate: new Date(Date.UTC(year, month, 0)),
  };
}
```

Spread `...calendarPeriodRange(year, month)` into existing test PayrollPeriod inserts so legacy tests keep their calendar-month meaning. Give the seed's June 2026 DRAFT explicit `startDate: d('2026-06-01')` and `endDate: d('2026-06-30')` rather than silently changing seeded behavior.

- [ ] **Step 4: Regenerate the Prisma client and validate schema syntax**

Run:

```bash
pnpm --filter server prisma:generate
pnpm --filter server exec prisma validate
```

Expected: Prisma client generation and schema validation both succeed. Do not run the destructive seed.

---

### Task 2: Extend payroll create/update contracts and serialization

**Files:**
- Modify: `server/src/modules/payroll/schemas.ts`
- Modify: `server/src/modules/payroll/routes.ts:5,49`
- Modify: `server/src/modules/payroll/controller.ts:9`
- Modify: `server/src/modules/payroll/service.ts:23-114`

**Interfaces:**
- Consumes: `POST /api/v1/payroll/periods` and `PATCH /api/v1/payroll/periods/:id`.
- Produces: `PayrollPeriod` JSON with `startDate`/`endDate` as `YYYY-MM-DD`; `createPeriod(input: CreatePeriodInput)`; `patchPeriod(id, input: PatchPeriodInput)`.

- [ ] **Step 1: Define strict date input and paired-field validation**

Use one strict calendar-day schema that returns a UTC-midnight `Date` and rejects rollovers such as 31 February:

```ts
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
  .transform((value, ctx) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'date must be a valid calendar date' });
      return z.NEVER;
    }
    return date;
  });
```

Make `startDate` and `endDate` optional on create only as a backward-compatible pair. Define `patchPeriodSchema` with optional `exchangeRate`, `startDate`, and `endDate`, then `superRefine` all of these rules:

- at least one supported change is present;
- Start and End are either both present or both absent;
- when both are present, End is not before Start.

Export `CreatePeriodInput` and `PatchPeriodInput`.

- [ ] **Step 2: Extend the route and controller without adding an endpoint**

Replace `patchRateSchema` with `patchPeriodSchema` in the existing PATCH route. Pass the parsed input object through the controller:

```ts
export async function createPeriod(req: Request, res: Response): Promise<void> {
  res.status(201).json(await payrollService.createPeriod(req.body as CreatePeriodInput));
}

export async function patchPeriod(req: Request, res: Response): Promise<void> {
  res.json(await payrollService.patchPeriod(Number(req.params.id), req.body as PatchPeriodInput));
}
```

- [ ] **Step 3: Make the server default authoritative**

Add internal service helpers; do not create a new utility file for a single payroll-module concern:

```ts
function defaultPeriodRange(year: number, month: number) {
  return {
    startDate: new Date(Date.UTC(year, month - 2, 26)),
    endDate: new Date(Date.UTC(year, month - 1, 25)),
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

`createPeriod` uses explicit parsed boundaries when supplied and otherwise uses `defaultPeriodRange`. It retains the existing Year/Month duplicate check and FX behavior.

- [ ] **Step 4: Prevent overlap and map database races to friendly 409 errors**

Before create or range update, query for an overlapping period:

```ts
where: {
  ...(excludeId ? { id: { not: excludeId } } : {}),
  startDate: { lte: endDate },
  endDate: { gte: startDate },
}
```

Throw `HttpError(409, 'Payroll period dates overlap an existing period')` when found. Also catch the database unique/exclusion constraint errors around writes and map them to a 409 so concurrent requests do not leak a generic 500.

- [ ] **Step 5: Consolidate DRAFT updates**

Rename `patchRate` to `patchPeriod`. Keep the existing DRAFT check, set `rateSource: 'MANUAL'` only when `exchangeRate` is present, and update both range fields together when supplied:

```ts
const data: Prisma.PayrollPeriodUpdateInput = {};
if (input.exchangeRate !== undefined) {
  data.exchangeRate = input.exchangeRate;
  data.rateSource = 'MANUAL';
}
if (input.startDate && input.endDate) {
  await assertNoPeriodOverlap(input.startDate, input.endDate, id);
  data.startDate = input.startDate;
  data.endDate = input.endDate;
}
```

- [ ] **Step 6: Serialize calendar dates safely**

Add `startDate` and `endDate` to `PeriodSummary` as strings and serialize with `isoDate`. Do not return raw JavaScript Date timestamps for these calendar-day fields.

---

### Task 3: Make calculations, finalization, locking, and PDF use the stored range

**Files:**
- Modify: `server/src/modules/payroll/service.ts:116-514`
- Modify: `server/src/lib/payroll.ts:44-390`
- Modify: `server/src/lib/periodLock.ts`
- Modify: `server/src/lib/pdf/payrollSheet.ts`

**Interfaces:**
- Consumes: inclusive `period.startDate: Date` and `period.endDate: Date`.
- Produces: `ComputeContext.periodStart`/`periodEnd`; range-based preview/finalization; range-based `assertPeriodEditable`; `PayrollSheetData.startDate`/`endDate`.

- [ ] **Step 1: Replace month-derived query bounds in the payroll service**

Change `computeRows` to:

```ts
async function computeRows(
  exchangeRate: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<PayslipRow[]>
```

Use these arguments in all six Prisma queries: employment overlap, overtime, daily logs, reimbursements, leave overlap, and holidays. Populate `ComputeContext` with `periodStart` and `periodEnd`, not Year and Month.

Update preview and finalization calls to pass the stored fields:

```ts
computeRows(Number(period.exchangeRate), period.startDate, period.endDate)
```

- [ ] **Step 2: Generalize the pure payroll library from a month to a range**

Change the context boundary fields:

```ts
export interface ComputeContext {
  // existing record arrays
  exchangeRate: number;
  periodStart: Date;
  periodEnd: Date;
}
```

Replace `inPeriod(date, year, month)` with inclusive comparison:

```ts
function inPeriod(date: Date, start: Date, end: Date): boolean {
  return date >= start && date <= end;
}
```

Change `daysInPeriodByType`, `computeAttendance`, reimbursement/overtime/log filtering, and `prorateMonth` inputs to use those explicit bounds. Preserve the existing formulas, rounding, deduction cap, and `detail.proration.monthWorkingDays` property name for stored-snapshot compatibility.

- [ ] **Step 3: Make finalized locking range-based**

Replace the Year/Month unique lookup in `assertPeriodEditable` with:

```ts
const period = await client.payrollPeriod.findFirst({
  where: {
    status: 'FINALIZED',
    startDate: { lte: date },
    endDate: { gte: date },
  },
});
```

When found, report its labeled month and stored range:

```ts
throw new HttpError(
  409,
  `Payroll period ${period.year}-${String(period.month).padStart(2, '0')} ` +
    `(${isoDate(period.startDate)} to ${isoDate(period.endDate)}) is finalized`,
);
```

- [ ] **Step 4: Pass real boundaries to the payroll-sheet PDF**

Add `startDate: string` and `endDate: string` to `PayrollSheetData`, pass serialized stored fields from `exportPeriodPdf`, and replace `periodBounds(data.year, data.month)` with those values. Remove the now-unused `periodBounds` import from `payrollSheet.ts`.

- [ ] **Step 5: Update finalization copy in code comments only where semantics changed**

Change comments saying "month" is locked or queried when they now mean the stored payroll range. Do not reformat or refactor adjacent logic.

---

### Task 4: Add editable date controls to the existing payroll UI

**Files:**
- Modify: `client/src/api/payroll.ts`
- Modify: `client/src/pages/payroll/PayrollPage.tsx`
- Modify: `client/src/pages/payroll/PayrollPeriodDetailPage.tsx`
- Modify: `client/src/lib/format.ts` only if a shared date-range formatter removes duplication

**Interfaces:**
- Consumes: server `PayrollPeriod.startDate`/`endDate` strings and existing mutation invalidation.
- Produces: create payload `{ year, month, startDate, endDate }`; `useUpdatePeriod`; editable DRAFT date range; read-only FINALIZED date range.

- [ ] **Step 1: Extend client API types and consolidate the PATCH mutation**

Add the two fields to `PayrollPeriod`:

```ts
startDate: string;
endDate: string;
```

Change create payload to require both date strings. Replace `useUpdateRate` with one mutation that supports rate or paired dates:

```ts
type UpdatePeriodPayload = {
  id: number;
  exchangeRate?: number;
  startDate?: string;
  endDate?: string;
};

export function useUpdatePeriod() {
  // PATCH existing endpoint and run existing payroll invalidation
}
```

- [ ] **Step 2: Add defaulted date pickers below Month in the create modal**

Use Day.js and Ant Design `DatePicker`. Keep the existing controlled form rather than introducing a second form architecture:

```ts
function defaultPeriodRange(year: number, month: number) {
  const end = dayjs().year(year).month(month - 1).date(25);
  return { start: end.subtract(1, 'month').date(26), end };
}
```

Initialize Start and End from the current selected Year/Month. Year or Month changes reset both values to the new default. Render two full-width fields directly below Month:

```tsx
<Form.Item label="Start Period" required>
  <DatePicker value={startPeriod} onChange={setStartPeriod} format="DD MMM YYYY" style={{ width: '100%' }} />
</Form.Item>
<Form.Item label="End Period" required validateStatus={invalidRange ? 'error' : undefined} help={invalidRange ? 'End Period must be on or after Start Period' : undefined}>
  <DatePicker value={endPeriod} onChange={setEndPeriod} format="DD MMM YYYY" style={{ width: '100%' }} />
</Form.Item>
```

Disable Create when a date is missing or reversed. Submit `format('YYYY-MM-DD')` strings. Preserve the server error and FX fallback messages.

- [ ] **Step 3: Display and edit the range on the detail page**

Import `DatePicker`, `dayjs`, and `formatDate`. Keep separate controlled Start/End values synchronized from query data in the existing effect. Add a compact range block in the header card:

- DRAFT: two date pickers and **Save period dates** button;
- FINALIZED: read-only `Start Period — End Period` text near the lock message.

The save handler calls `useUpdatePeriod` with both formatted dates, shows a success/error message, and relies on existing query invalidation to recompute the preview. Keep the existing rate editing behavior through the same hook.

- [ ] **Step 4: Make finalization confirmation describe the real range**

Replace "records dated in this month" with copy that names the formatted stored range. Correct the existing notification wording from "emails dispatched"/"Email each employee" to the app's actual in-app notifications while touching this modal:

```tsx
<li>Lock all source records dated {formatDate(period.startDate)}–{formatDate(period.endDate)}.</li>
<li>Notify each employee that their payslip is available.</li>
```

- [ ] **Step 5: Build both workspaces before writing tests**

Run:

```bash
pnpm build
```

Expected: server TypeScript and client TypeScript/Vite builds succeed. Fix production-code type errors before proceeding to tests.

---

### Task 5: Add post-implementation regression coverage

**Files:**
- Modify: `server/src/modules/payroll/__tests__/payroll.routes.test.ts`
- Modify: `server/src/modules/payroll/__tests__/payroll.service.test.ts`
- Modify: `server/src/lib/__tests__/payroll.test.ts`
- Modify: `server/src/lib/__tests__/pdf.test.ts`
- Modify: `server/src/modules/leave/__tests__/leave.service.test.ts`
- Modify: `server/src/modules/notifications/__tests__/notifications.emit.test.ts` only for required fixture fields
- Modify: `server/src/__tests__/helpers/factories.ts`

**Interfaces:**
- Consumes: implemented range-aware API, calculation, lock, and migration constraints.
- Produces: regression evidence for all approved business rules; no tests are written before production behavior exists.

- [ ] **Step 1: Add HR route coverage for create and PATCH**

Add route-level tests proving:

```ts
// POST without dates defaults August 2026 to 2026-07-26 through 2026-08-25.
// POST with custom dates stores and serializes the exact range.
// POST/PATCH rejects reversed or one-sided ranges with 400.
// PATCH updates a DRAFT range and returns both YYYY-MM-DD values.
// PATCH rejects FINALIZED date changes with 409 and leaves stored dates unchanged.
// A range overlapping another period returns 409.
// A non-HR cannot PATCH period dates.
```

For every rejected mutation, read the database afterward and assert that stored boundaries did not change.

- [ ] **Step 2: Add service integration coverage for a cross-month range**

Create a 26 July–25 August DRAFT with records on both sides of each boundary. Assert that:

- July 26 and August 25 records are included;
- July 25 and August 26 records are excluded;
- leave spanning the boundary is clipped;
- employment overlap and full-time proration use the complete custom range;
- attendance stores `periodStart: '2026-07-26'` and `periodEnd: '2026-08-25'`.

- [ ] **Step 3: Update pure calculation tests**

Replace fixture `year`/`month` context fields with explicit `periodStart`/`periodEnd`. Add one focused custom-range case containing point records and a spanning leave so the pure library proves inclusive boundaries independently of Prisma.

- [ ] **Step 4: Verify database constraints directly**

After creating one PayrollPeriod, attempt direct Prisma inserts with a reversed range and with an overlapping range. Assert both reject. This exercises the CHECK and exclusion constraints without relying only on service pre-checks.

- [ ] **Step 5: Verify the shared finalized lock across the cutoff**

Extend the existing leave period-lock tests: finalize a 26 July–25 August period, then prove cancellation on 26 July and 25 August returns 409 while a request starting 25 July or 26 August remains editable. This confirms all existing consumers inherit the shared range behavior without duplicating module-specific code.

- [ ] **Step 6: Verify PDF range rendering**

Update `PayrollSheetData` fixtures with custom start/end strings and assert the extracted PDF text contains the formatted custom range. Keep existing payslip snapshot fallback tests unchanged.

- [ ] **Step 7: Run targeted tests**

Run:

```bash
pnpm --filter server test -- src/modules/payroll/__tests__/payroll.routes.test.ts
pnpm --filter server test -- src/modules/payroll/__tests__/payroll.service.test.ts
pnpm --filter server test -- src/lib/__tests__/payroll.test.ts
pnpm --filter server test -- src/lib/__tests__/pdf.test.ts
pnpm --filter server test -- src/modules/leave/__tests__/leave.service.test.ts
```

Expected: all targeted files pass against the automatically created/migrated `hrms_test` database.

---

### Task 6: Update source-of-truth documentation and verify the complete change

**Files:**
- Modify: `handbook/domain-rules.md`
- Modify: `handbook/data-model.md`
- Modify: `handbook/api-reference.md`
- Modify: `handbook/frontend.md`
- Modify: `handbook/testing.md` if the test inventory changes
- Modify: `handbook/known-issues.md` only where wording incorrectly assumes a calendar-month lock

**Interfaces:**
- Consumes: verified implemented behavior.
- Produces: handbook documentation matching the real 26–25/custom-range rules and a clean final verification report.

- [ ] **Step 1: Update the handbook after behavior is stable**

Document these exact changes:

- `PayrollPeriod.startDate` and `endDate` are inclusive PostgreSQL dates;
- new default is 26 previous month–25 selected month;
- HR may edit a DRAFT pair, not a FINALIZED pair;
- overlaps and reversed ranges are database-constrained;
- calculations and locks follow the stored range, while Year/Month remains the label;
- legacy periods were backfilled to their original calendar bounds.

Do not rewrite unrelated historical or known-issue sections.

- [ ] **Step 2: Run formatting/type/lint checks**

Run:

```bash
pnpm lint:fix
pnpm build
```

Expected: lint completes without errors and both workspaces build.

- [ ] **Step 3: Run the complete automated suite**

Run:

```bash
pnpm test
```

Expected: every workspace test passes. Record the exact passed-test count from the output rather than quoting the stale handbook count.

- [ ] **Step 4: Exercise the golden path in the local UI**

Start the local app only if its existing dependencies and local database are already available; do not install, seed, or touch a live system. Verify:

1. New Period for August 2026 displays 26 July and 25 August.
2. HR can change both dates and create the period.
3. The detail page shows the stored range and Save period dates changes the preview.
4. Reversed dates are blocked visibly.
5. Finalization confirmation names the custom range.
6. A FINALIZED detail page shows read-only dates.

- [ ] **Step 5: Review only the intended diff**

Run `git diff --` for the exact files in this plan plus the two new files. Confirm every changed application line traces to the approved feature and that `DailyLogModal.tsx` remains untouched.

- [ ] **Step 6: Dispatch post-implementation verification and review subagents**

After all local checks, dispatch separate subagents as required by `AGENTS.md`:

- verification reviewer: run targeted golden-path/edge checks and report failures;
- code reviewer: inspect data correctness, concurrency protection, date/timezone handling, security/authorization, migration safety, and unnecessary scope.

Apply valid findings, rerun affected checks, and repeat the final verification pass. Do not ask either subagent to write production code before the implementation exists.
