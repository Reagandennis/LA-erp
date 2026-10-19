-- AlterTable
ALTER TABLE "public"."TripItineraryItem" ADD COLUMN     "driverId" INTEGER,
ADD COLUMN     "officerId" INTEGER,
ADD COLUMN     "vehicleId" INTEGER;

-- CreateIndex
CREATE INDEX "TripItineraryItem_driverId_idx" ON "public"."TripItineraryItem"("driverId");

-- CreateIndex
CREATE INDEX "TripItineraryItem_officerId_idx" ON "public"."TripItineraryItem"("officerId");

-- CreateIndex
CREATE INDEX "TripItineraryItem_vehicleId_idx" ON "public"."TripItineraryItem"("vehicleId");

-- AddForeignKey
ALTER TABLE "public"."TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "public"."Officer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

