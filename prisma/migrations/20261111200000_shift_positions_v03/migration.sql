-- Shift planning, platform template v0.3: positions (TRC, Project Coordinator,
-- Driver), the driver pattern, the cover order on a call-in, and the
-- compensatory-time ledger. Additive: no existing row changes meaning.

-- AlterTable
ALTER TABLE "public"."ShiftConfig"
  ADD COLUMN "driverAnchor" TEXT NOT NULL DEFAULT '2026-11-30',
  ADD COLUMN "sickFullDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "sickHalfDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "ctoExpiryDays" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "public"."ShiftLine" ADD COLUMN "position" TEXT NOT NULL DEFAULT 'trc';

-- AlterTable
ALTER TABLE "public"."ShiftCallIn" ADD COLUMN "source" TEXT;

-- CreateTable
CREATE TABLE "public"."ShiftCto" (
    "id" SERIAL NOT NULL,
    "lineId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "days" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "recordId" INTEGER,
    "expiresOn" TEXT,
    "note" TEXT,
    "approvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftCto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCto_recordId_key" ON "public"."ShiftCto"("recordId");

-- CreateIndex
CREATE INDEX "ShiftCto_lineId_date_idx" ON "public"."ShiftCto"("lineId", "date");

-- AddForeignKey
ALTER TABLE "public"."ShiftCto" ADD CONSTRAINT "ShiftCto_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "public"."ShiftLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Leave saved as "other" before the types followed the roster codes is unpaid leave.
UPDATE "public"."ShiftLeave" SET "type" = 'unpaid' WHERE "type" = 'other';

-- The template's rotation starts on 1 December 2026, and its cycle offsets are
-- counted from there. Moved only while nobody is on the roster, so no saved
-- offset changes meaning.
UPDATE "public"."ShiftConfig" SET "rotationStart" = '2026-12-01'
WHERE NOT EXISTS (SELECT 1 FROM "public"."ShiftLine");
