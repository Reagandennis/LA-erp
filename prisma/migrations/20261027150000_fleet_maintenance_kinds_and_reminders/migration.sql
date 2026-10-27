-- AlterTable
ALTER TABLE "public"."VehicleMaintenance" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'Scheduled',
ADD COLUMN     "reminderDays" INTEGER,
ALTER COLUMN "status" SET DEFAULT 'Planned';

-- The open status "Scheduled" is now "Planned": "Scheduled" names the kind of work.
UPDATE "public"."VehicleMaintenance" SET "status" = 'Planned' WHERE "status" = 'Scheduled';
UPDATE "public"."VehicleMaintenance" SET "kind" = 'Unscheduled' WHERE "category" = 'Repair';

-- CreateTable
CREATE TABLE "public"."VehicleMaintenanceNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "maintenanceId" INTEGER NOT NULL,
    "reminderKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "VehicleMaintenanceNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleMaintenanceNotification_userId_createdAt_idx" ON "public"."VehicleMaintenanceNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleMaintenanceNotification_maintenanceId_idx" ON "public"."VehicleMaintenanceNotification"("maintenanceId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleMaintenanceNotification_userId_reminderKey_key" ON "public"."VehicleMaintenanceNotification"("userId", "reminderKey");

-- AddForeignKey
ALTER TABLE "public"."VehicleMaintenanceNotification" ADD CONSTRAINT "VehicleMaintenanceNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleMaintenanceNotification" ADD CONSTRAINT "VehicleMaintenanceNotification_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "public"."VehicleMaintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

