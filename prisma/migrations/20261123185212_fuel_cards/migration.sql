-- AlterTable
ALTER TABLE "public"."VehicleFuelLog" ADD COLUMN     "fuelCardId" INTEGER;

-- CreateTable
CREATE TABLE "public"."FuelCard" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT 'LADYASKARI',
    "cardNumber" TEXT,
    "lowBalanceThreshold" DECIMAL(14,2) NOT NULL DEFAULT 5000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lowAlertedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuelCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FuelCardTopUp" (
    "id" SERIAL NOT NULL,
    "cardId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'Top-up',
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuelCardTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FuelCardNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "cardId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'fuel-card.low',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "FuelCardNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuelCard_active_idx" ON "public"."FuelCard"("active");

-- CreateIndex
CREATE INDEX "FuelCardTopUp_cardId_occurredAt_idx" ON "public"."FuelCardTopUp"("cardId", "occurredAt");

-- CreateIndex
CREATE INDEX "FuelCardNotification_userId_createdAt_idx" ON "public"."FuelCardNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FuelCardNotification_cardId_idx" ON "public"."FuelCardNotification"("cardId");

-- CreateIndex
CREATE INDEX "VehicleFuelLog_fuelCardId_idx" ON "public"."VehicleFuelLog"("fuelCardId");

-- AddForeignKey
ALTER TABLE "public"."VehicleFuelLog" ADD CONSTRAINT "VehicleFuelLog_fuelCardId_fkey" FOREIGN KEY ("fuelCardId") REFERENCES "public"."FuelCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FuelCard" ADD CONSTRAINT "FuelCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FuelCardTopUp" ADD CONSTRAINT "FuelCardTopUp_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "public"."FuelCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FuelCardTopUp" ADD CONSTRAINT "FuelCardTopUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FuelCardNotification" ADD CONSTRAINT "FuelCardNotification_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "public"."FuelCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FuelCardNotification" ADD CONSTRAINT "FuelCardNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Register the module so it appears in the sidebar (under Car Fuel) and can be
-- granted; the seed keeps it current afterwards.
INSERT INTO "public"."Module" ("slug", "name", "description", "category", "sortOrder", "createdAt", "updatedAt")
VALUES (
  'fuel-cards',
  'Fuel Cards',
  'Prepaid fuel cards for the internal fleet: balances, top-ups, statements, and low-balance alerts.',
  'Fleet',
  52,
  now(),
  now()
)
ON CONFLICT ("slug") DO NOTHING;

-- The two cards the fleet starts with. They begin at a zero balance: record
-- the money on each card as its first top-up.
INSERT INTO "public"."FuelCard" ("name", "provider", "entity", "lowBalanceThreshold", "updatedAt")
VALUES
  ('Shell Fuel Card', 'Shell', 'LADYASKARI', 5000, now()),
  ('TotalEnergies Fuel Card', 'TotalEnergies', 'LADYASKARI', 5000, now());
