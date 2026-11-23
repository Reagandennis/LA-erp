-- AlterTable
ALTER TABLE "public"."FuelCard" ADD COLUMN     "vehicleId" INTEGER;

-- CreateIndex
CREATE INDEX "FuelCard_vehicleId_idx" ON "public"."FuelCard"("vehicleId");

-- AddForeignKey
ALTER TABLE "public"."FuelCard" ADD CONSTRAINT "FuelCard_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
