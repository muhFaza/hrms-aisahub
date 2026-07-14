-- AlterTable
ALTER TABLE "Overtime" ADD COLUMN     "rejectReason" TEXT;

-- AlterTable
ALTER TABLE "Reimbursement" ADD COLUMN     "rejectReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DailyLog_employeeId_date_key" ON "DailyLog"("employeeId", "date");
