-- CreateTable
CREATE TABLE "HandoverEntry" (
    "id" SERIAL NOT NULL,
    "shiftDate" TIMESTAMP(3) NOT NULL,
    "shiftPeriod" TEXT NOT NULL DEFAULT 'Day',
    "post" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Normal',
    "summary" TEXT NOT NULL,
    "incidents" TEXT,
    "watchItems" TEXT,
    "createdById" INTEGER NOT NULL,
    "acknowledgedById" INTEGER,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoverEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoverEntry_shiftDate_idx" ON "HandoverEntry"("shiftDate");

-- CreateIndex
CREATE INDEX "HandoverEntry_status_idx" ON "HandoverEntry"("status");

-- CreateIndex
CREATE INDEX "HandoverEntry_acknowledgedById_idx" ON "HandoverEntry"("acknowledgedById");

-- AddForeignKey
ALTER TABLE "HandoverEntry" ADD CONSTRAINT "HandoverEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverEntry" ADD CONSTRAINT "HandoverEntry_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rename the existing "Bulletin Board" module to "Handover" in place so user
-- access assignments (UserModule.moduleId) are preserved.
UPDATE "Module"
SET "slug" = 'handover',
    "name" = 'Handover',
    "description" = 'Shift handover log — record the situation, flag what the next shift must watch, and acknowledge receipt.',
    "category" = 'Operations',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'bulletin-board';
