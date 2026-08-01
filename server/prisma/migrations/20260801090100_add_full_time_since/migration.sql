-- Anchors paid-leave accrual to the date an employee became full-time, rather than their
-- join date. A part-timer later promoted to full-time previously earned a retroactive paid
-- day for every month they were part-time, because ensureAccrualsUpToDate caught up from
-- joinDate.
--
-- joinDate is untouched and remains the hire date. fullTimeSince is purely the accrual
-- anchor, and is NULL for part-timers, who neither take leave nor earn it.
ALTER TABLE "Employee" ADD COLUMN "fullTimeSince" TIMESTAMP(3);

-- Backfill. There is no employmentType history in the schema, so joinDate is the only
-- anchor available for employees who are full-time today. This reproduces the existing
-- behaviour exactly for every current full-timer: no accrual row is created, removed or
-- altered by this migration, and no balance moves. Part-timers are left NULL.
UPDATE "Employee" SET "fullTimeSince" = "joinDate" WHERE "employmentType" = 'FULL_TIME';
