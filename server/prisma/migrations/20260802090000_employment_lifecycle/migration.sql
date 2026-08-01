-- Employment lifecycle: termination, contract-end reminders, rehire.
--
-- Employment becomes a sequence of rows rather than a boolean. Every dated fact that
-- describes ONE engagement moves off Employee and onto Employment, so a rehire opens a new
-- row instead of overwriting the previous engagement's history.
--
-- This migration DROPS FOUR COLUMNS on live payroll data. Prisma has no down-migrations, so
-- a code rollback would leave the schema migrated. Take a pg_dump immediately before
-- deploying.
--
-- Verified against production before writing: 4 employees, 0 with isActive = false, so the
-- "unknown termination date" branch below is a no-op there. It is written defensively
-- anyway, because seeded and development databases do contain inactive employees.

-- 1. Enums -------------------------------------------------------------------------------
--
-- CONTRACT_ENDING is added to NotificationType by the preceding migration, on its own, for
-- the transaction reason documented there. Creating a brand-new type and using it in the
-- same transaction is fine — that restriction applies only to ADD VALUE on an existing one.

CREATE TYPE "EmploymentEndReason" AS ENUM ('CONTRACT_END', 'RESIGNATION', 'DISMISSAL', 'OTHER');

-- 2. Employment --------------------------------------------------------------------------

CREATE TABLE "Employment" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "endReason" "EmploymentEndReason",
    "endNote" TEXT,
    "contractStartDate" TIMESTAMP(3),
    "contractEndDate" TIMESTAMP(3),
    "contractFilePath" TEXT,
    "fullTimeSince" TIMESTAMP(3),
    "leaveBalanceAtEnd" DECIMAL(6,2),
    "recordedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Employment_employeeId_idx" ON "Employment"("employeeId");
CREATE INDEX "Employment_contractEndDate_idx" ON "Employment"("contractEndDate");

-- At most one OPEN employment per employee. A partial unique index is what makes
-- "currently employed" unambiguous rather than a convention the application has to keep.
CREATE UNIQUE INDEX "Employment_one_open_per_employee"
    ON "Employment"("employeeId") WHERE "endDate" IS NULL;

-- The boundary rule that decides pay, enforced in the database rather than only in code.
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_end_after_start"
    CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

-- An OPEN employment has not ended, so it cannot carry any of the facts about how it ended.
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_open_has_no_end_facts"
    CHECK ("endDate" IS NOT NULL OR ("endReason" IS NULL AND "endNote" IS NULL AND "leaveBalanceAtEnd" IS NULL));

ALTER TABLE "Employment" ADD CONSTRAINT "Employment_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Backfill one Employment per existing Employee ----------------------------------------
--
-- startDate comes from joinDate, and the contract window and accrual anchor move across
-- verbatim. endDate is NULL for anyone currently active.
--
-- For an employee already at isActive = false we have no recorded termination date: the old
-- schema simply could not express one. updatedAt is the best available signal of when they
-- were switched off. endReason stays NULL, which is precisely the marker that this row was
-- reconstructed rather than recorded — the terminate endpoint always supplies one.
INSERT INTO "Employment" (
    "employeeId", "startDate", "endDate", "endReason", "endNote",
    "contractStartDate", "contractEndDate", "contractFilePath",
    "fullTimeSince", "recordedById", "createdAt", "updatedAt"
)
SELECT
    "id",
    "joinDate",
    -- GREATEST guards the ordering: an employee whose joinDate is later than the updatedAt
    -- we are reconstructing from would otherwise get endDate < startDate, and prorateMonth
    -- then computes a factor of 0 — a permanently zero payslip with no UI able to correct it.
    CASE WHEN "isActive" THEN NULL ELSE GREATEST(date_trunc('day', "updatedAt"), "joinDate") END,
    NULL,
    CASE WHEN "isActive" THEN NULL
         ELSE 'Termination date reconstructed by migration; the previous schema did not record one.'
    END,
    "contractStartDate",
    "contractEndDate",
    "contractFilePath",
    "fullTimeSince",
    NULL,
    "createdAt",
    CURRENT_TIMESTAMP
FROM "Employee";

-- 4. Point accruals at the employment they belong to ---------------------------------------

ALTER TABLE "LeaveAccrual" ADD COLUMN "employmentId" INTEGER;

UPDATE "LeaveAccrual" a
SET "employmentId" = e."id"
FROM "Employment" e
WHERE e."employeeId" = a."employeeId";

-- Every employee got exactly one Employment above, so no accrual can be left unmatched.
-- Fail loudly rather than silently dropping the NOT NULL if that ever stops being true.
DO $$
DECLARE orphaned INTEGER;
BEGIN
    SELECT count(*) INTO orphaned FROM "LeaveAccrual" WHERE "employmentId" IS NULL;
    IF orphaned > 0 THEN
        RAISE EXCEPTION 'LeaveAccrual backfill left % row(s) without an employment', orphaned;
    END IF;
END $$;

ALTER TABLE "LeaveAccrual" ALTER COLUMN "employmentId" SET NOT NULL;

-- Composite rather than a plain FK on employmentId alone. LeaveAccrual carries BOTH
-- employeeId and employmentId: balance reads filter on employmentId while reporting joins on
-- employeeId, so a row pairing one employee's id with another's employment would be invisible
-- to its owner's balance and consume against somebody else's — silently. This makes that
-- pairing unrepresentable.
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_id_employeeId_key" UNIQUE ("id", "employeeId");
ALTER TABLE "LeaveAccrual" ADD CONSTRAINT "LeaveAccrual_employment_employee_fkey"
    FOREIGN KEY ("employmentId", "employeeId") REFERENCES "Employment"("id", "employeeId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Scoped to the employment: someone terminated and rehired inside one month would otherwise
-- collide on (employeeId, period) and lose the second row.
DROP INDEX "LeaveAccrual_employeeId_period_key";
CREATE UNIQUE INDEX "LeaveAccrual_employmentId_period_key" ON "LeaveAccrual"("employmentId", "period");
CREATE INDEX "LeaveAccrual_employeeId_idx" ON "LeaveAccrual"("employeeId");

-- 5. Drop what Employment now owns ---------------------------------------------------------
--
-- joinDate deliberately stays on Employee as the ORIGINAL first join, so tenure survives a
-- rehire even though each engagement carries its own startDate.

ALTER TABLE "Employee" DROP COLUMN "isActive";
ALTER TABLE "Employee" DROP COLUMN "contractStartDate";
ALTER TABLE "Employee" DROP COLUMN "contractEndDate";
ALTER TABLE "Employee" DROP COLUMN "contractFilePath";
ALTER TABLE "Employee" DROP COLUMN "fullTimeSince";
