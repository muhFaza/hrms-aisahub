-- Payroll periods are labeled by year/month but may cover a custom inclusive date range.
-- Existing periods retain their calendar-month boundaries so historical payslips and locks
-- do not change meaning when this migration is deployed.

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

-- Inclusive overlap prevention is enforced in the database as well as the service so two
-- concurrent HR requests cannot put the same source record into two payroll periods.
ALTER TABLE "PayrollPeriod"
  ADD CONSTRAINT "PayrollPeriod_range_no_overlap"
  EXCLUDE USING gist (daterange("startDate", "endDate", '[]') WITH &&);
