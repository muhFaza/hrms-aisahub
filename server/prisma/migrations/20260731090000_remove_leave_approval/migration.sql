-- Leave loses its approval step: a stored request is leave that is taken, effective on
-- submit, with paid-leave balance consumed at submission time instead of at approval.
--
-- Prisma runs this file as one transaction, so either every step below lands or none does.
-- Steps 1-3 read "status" and must therefore run before step 4 drops it.
--
-- There is NO down migration: dropping "status" destroys the taken/rejected distinction
-- irrecoverably. Recovery is the database backup — take a fresh pg_dump before deploying.

-- Step 0 — Lock out concurrent writers.
-- During a rolling deploy the old container is still serving. Without this, it can insert a
-- PENDING PAID request between the guard below and the consumption that follows, and that
-- row would survive as taken leave that never consumed any balance. EXCLUSIVE blocks writes
-- (and the row locks submitLeave takes) while still allowing plain reads.
LOCK TABLE "LeaveRequest", "LeaveAccrual" IN EXCLUSIVE MODE;

-- Step 1 — Guard.
-- Every PENDING PAID request is about to become taken leave and consume balance. If an
-- employee's pending days exceed what they can actually fund, that is a data problem for a
-- human to resolve: abort rather than under-consume and leave the balance overstated.
DO $$
DECLARE
  offenders TEXT;
BEGIN
  SELECT string_agg(
           format('employee %s needs %s day(s) but has %s', t."employeeId", t.needed, t.available),
           '; ' ORDER BY t."employeeId"
         )
    INTO offenders
    FROM (
      SELECT r."employeeId",
             SUM(r."totalDays") AS needed,
             COALESCE((
               SELECT SUM(a."days" - a."daysConsumed")
                 FROM "LeaveAccrual" a
                WHERE a."employeeId" = r."employeeId"
                  AND a."expiresAt" > now()
             ), 0) AS available
        FROM "LeaveRequest" r
       WHERE r."status" = 'PENDING'
         AND r."type" = 'PAID'
       GROUP BY r."employeeId"
    ) t
   WHERE t.needed > t.available;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'remove_leave_approval: pending paid leave exceeds the available balance (%). Approve, reject or cancel these requests before migrating.',
      offenders;
  END IF;
END $$;

-- Step 2 — Retroactive FIFO consumption.
-- Draw each employee's total pending PAID days from their non-expired accrual rows,
-- oldest-expiring first ("expiresAt" ASC, "period" ASC) — the same order planFifoAllocation
-- applies at runtime. The running total of everything ordered ahead of a row is how much of
-- the need earlier rows already covered; LEAST(available, ...) keeps the
-- LeaveAccrual_daysConsumed_within_days CHECK safe by construction.
WITH need AS (
  SELECT "employeeId", SUM("totalDays") AS needed
    FROM "LeaveRequest"
   WHERE "status" = 'PENDING'
     AND "type" = 'PAID'
   GROUP BY "employeeId"
), ordered AS (
  SELECT a."id",
         n.needed,
         a."days" - a."daysConsumed" AS available,
         COALESCE(SUM(a."days" - a."daysConsumed") OVER (
           PARTITION BY a."employeeId"
           ORDER BY a."expiresAt" ASC, a."period" ASC
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS prior
    FROM "LeaveAccrual" a
    JOIN need n ON n."employeeId" = a."employeeId"
   WHERE a."expiresAt" > now()
)
UPDATE "LeaveAccrual" a
   SET "daysConsumed" = a."daysConsumed" + LEAST(o.available, GREATEST(o.needed - o.prior, 0))
  FROM ordered o
 WHERE o."id" = a."id"
   AND LEAST(o.available, GREATEST(o.needed - o.prior, 0)) > 0;

-- Step 3 — Delete rejected rows.
-- With no status column a rejected row is indistinguishable from taken leave, which would
-- silently invent leave that never happened.
DELETE FROM "LeaveRequest" WHERE "status" = 'REJECTED';

-- Step 4 — Drop the approval columns.
-- "RequestStatus" itself stays: Overtime and Reimbursement still use it.
ALTER TABLE "LeaveRequest" DROP CONSTRAINT "LeaveRequest_reviewedById_fkey";

ALTER TABLE "LeaveRequest"
  DROP COLUMN "status",
  DROP COLUMN "reviewedById",
  DROP COLUMN "reviewedAt",
  DROP COLUMN "rejectReason";
