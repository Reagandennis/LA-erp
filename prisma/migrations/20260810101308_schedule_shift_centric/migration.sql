-- DropIndex
DROP INDEX "ScheduleShift_employeeId_date_key";

-- AlterTable
ALTER TABLE "ScheduleShift" ADD COLUMN     "breakMinutes" INTEGER,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "role" TEXT;

-- CreateIndex
CREATE INDEX "ScheduleShift_employeeId_date_idx" ON "ScheduleShift"("employeeId", "date");
