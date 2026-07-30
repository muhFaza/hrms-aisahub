-- Data migration (no schema change): remove the seeded owner@aisahub.com account.
--
-- The seed used to create two HR-role accounts, hr@ and owner@. Only one is
-- needed, so deployed databases need the extra row cleared out too — otherwise
-- a login that no longer exists in the seed keeps working in production.
--
-- Every foreign key pointing at "User" is ON DELETE SET NULL, so deleting the
-- row outright would quietly drop the reviewer on anything it approved and the
-- finalizer on any payroll period it closed. Reassign that attribution to the
-- remaining HR account first.

DO $$
DECLARE
  owner_id     INTEGER;
  successor_id INTEGER;
BEGIN
  SELECT id INTO owner_id FROM "User" WHERE email = 'owner@aisahub.com';

  -- Nothing to do on databases that never had the account (or already ran this).
  IF owner_id IS NULL THEN
    RETURN;
  END IF;

  -- Oldest remaining active HR account inherits the audit trail.
  SELECT u.id INTO successor_id
  FROM "User" u
  JOIN "Role" r ON r.id = u."roleId"
  WHERE r.name = 'HR'
    AND u.id <> owner_id
    AND u."isActive"
  ORDER BY u.id
  LIMIT 1;

  IF successor_id IS NOT NULL THEN
    UPDATE "LeaveRequest"  SET "reviewedById"  = successor_id WHERE "reviewedById"  = owner_id;
    UPDATE "Overtime"      SET "reviewedById"  = successor_id WHERE "reviewedById"  = owner_id;
    UPDATE "Reimbursement" SET "reviewedById"  = successor_id WHERE "reviewedById"  = owner_id;
    UPDATE "PayrollPeriod" SET "finalizedById" = successor_id WHERE "finalizedById" = owner_id;
  END IF;
  -- If there is no other active HR account, the SET NULL foreign keys apply and
  -- the records survive without a reviewer rather than blocking the migration.

  DELETE FROM "User" WHERE id = owner_id;
END $$;
