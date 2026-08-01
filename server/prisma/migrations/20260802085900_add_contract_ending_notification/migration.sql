-- Adds the CONTRACT_ENDING notification type, used to warn HR that an employment contract
-- is within its reminder window so they can renew it or record a termination.
--
-- This migration contains ONLY the enum addition, matching the convention set by
-- 20260801090000_add_unpaid_leave_type. PostgreSQL permits ALTER TYPE ... ADD VALUE inside
-- a transaction block (which is how Prisma runs migrations) from PG 12 on, but the new
-- value cannot be USED in that same transaction. Never combine this with a statement that
-- inserts or compares a CONTRACT_ENDING row.
ALTER TYPE "NotificationType" ADD VALUE 'CONTRACT_ENDING';
