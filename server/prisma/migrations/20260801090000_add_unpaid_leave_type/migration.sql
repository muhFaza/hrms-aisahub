-- Adds the UNPAID leave type. Unpaid leave deducts salary on the same mechanics as SICK:
-- working days clipped to the payroll month, weekends and holidays excluded, times the
-- daily rate. It consumes no accrual balance and refunds nothing on cancellation.
--
-- This migration contains ONLY the enum addition. PostgreSQL permits ALTER TYPE ... ADD
-- VALUE inside a transaction block (which is how Prisma runs migrations) from PG 12 on,
-- but the new value cannot be USED in that same transaction. Never combine this with a
-- statement that inserts or compares an UNPAID row.
ALTER TYPE "LeaveType" ADD VALUE 'UNPAID';
