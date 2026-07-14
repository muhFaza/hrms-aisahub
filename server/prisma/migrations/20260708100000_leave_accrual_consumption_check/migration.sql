-- Enforce that consumed paid-leave days stay within the accrued amount, so a
-- concurrent-approval race cannot over-consume a LeaveAccrual row (design §4).
ALTER TABLE "LeaveAccrual"
  ADD CONSTRAINT "LeaveAccrual_daysConsumed_within_days"
  CHECK ("daysConsumed" >= 0 AND "daysConsumed" <= "days");
