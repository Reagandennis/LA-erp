-- CreateTable
CREATE TABLE "public"."VehicleFuelLog" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "litres" DECIMAL(10,2) NOT NULL,
    "cost" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "odometerKm" INTEGER,
    "fuelType" TEXT NOT NULL DEFAULT 'Petrol',
    "fullTank" BOOLEAN NOT NULL DEFAULT true,
    "station" TEXT,
    "filledBy" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleFuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VehicleMaintenance" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Service',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "scheduledFor" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "odometerKm" INTEGER,
    "cost" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT,
    "nextDueAt" TIMESTAMP(3),
    "nextDueKm" INTEGER,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleFuelLog_vehicleId_filledAt_idx" ON "public"."VehicleFuelLog"("vehicleId", "filledAt");

-- CreateIndex
CREATE INDEX "VehicleFuelLog_filledAt_idx" ON "public"."VehicleFuelLog"("filledAt");

-- CreateIndex
CREATE INDEX "VehicleFuelLog_createdById_idx" ON "public"."VehicleFuelLog"("createdById");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_vehicleId_status_idx" ON "public"."VehicleMaintenance"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_status_scheduledFor_idx" ON "public"."VehicleMaintenance"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_createdById_idx" ON "public"."VehicleMaintenance"("createdById");

-- AddForeignKey
ALTER TABLE "public"."VehicleFuelLog" ADD CONSTRAINT "VehicleFuelLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleFuelLog" ADD CONSTRAINT "VehicleFuelLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleMaintenance" ADD CONSTRAINT "VehicleMaintenance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleMaintenance" ADD CONSTRAINT "VehicleMaintenance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

