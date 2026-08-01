-- A reimbursement is a claim on company money, so the reason and the receipt behind it
-- are not optional. The API has required both since the endpoint was written; only the
-- database still allowed a claim with neither.

-- Backfill first: rows predating the app-level requirement would fail SET NOT NULL.
-- Empty string reads as "no evidence on record" to getEvidencePath, which already
-- guards on falsy, so those rows keep behaving exactly as they do today.
UPDATE "Reimbursement" SET "description" = '' WHERE "description" IS NULL;
UPDATE "Reimbursement" SET "evidenceFilePath" = '' WHERE "evidenceFilePath" IS NULL;

ALTER TABLE "Reimbursement"
  ALTER COLUMN "description" SET NOT NULL,
  ALTER COLUMN "evidenceFilePath" SET NOT NULL;
