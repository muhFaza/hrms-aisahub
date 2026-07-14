-- AlterTable: add FX rate provenance (API | FALLBACK | MANUAL) to payroll periods (design §4)
ALTER TABLE "PayrollPeriod" ADD COLUMN "rateSource" TEXT NOT NULL DEFAULT 'API';
