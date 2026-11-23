-- CreateTable
CREATE TABLE "public"."ParkingCard" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "vehicleId" INTEGER,
    "cardNumber" TEXT,
    "lowBalanceThreshold" DECIMAL(14,2) NOT NULL DEFAULT 500,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkingCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ParkingCardEntry" (
    "id" SERIAL NOT NULL,
    "cardId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "observedBalance" DECIMAL(14,2),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "vehicleId" INTEGER,
    "location" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkingCardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParkingCard_active_idx" ON "public"."ParkingCard"("active");

-- CreateIndex
CREATE INDEX "ParkingCard_vehicleId_idx" ON "public"."ParkingCard"("vehicleId");

-- CreateIndex
CREATE INDEX "ParkingCardEntry_cardId_occurredAt_idx" ON "public"."ParkingCardEntry"("cardId", "occurredAt");

-- CreateIndex
CREATE INDEX "ParkingCardEntry_vehicleId_idx" ON "public"."ParkingCardEntry"("vehicleId");

-- AddForeignKey
ALTER TABLE "public"."ParkingCard" ADD CONSTRAINT "ParkingCard_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ParkingCard" ADD CONSTRAINT "ParkingCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ParkingCardEntry" ADD CONSTRAINT "ParkingCardEntry_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "public"."ParkingCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ParkingCardEntry" ADD CONSTRAINT "ParkingCardEntry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ParkingCardEntry" ADD CONSTRAINT "ParkingCardEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Register the module so it appears in the sidebar (under Vehicles) and can be
-- granted; the seed keeps it current afterwards.
INSERT INTO "public"."Module" ("slug", "name", "description", "category", "sortOrder", "createdAt", "updatedAt")
VALUES (
  'parking-cards',
  'Parking Cards',
  'Parking and toll cards (KAPS, PAYTECH, PARK n GO, Express Way): log parking, top up, and keep balances right.',
  'Fleet',
  19,
  now(),
  now()
)
ON CONFLICT ("slug") DO NOTHING;
