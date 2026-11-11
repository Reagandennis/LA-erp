-- Vendors and the trip resource pool (lib/vendors.ts, lib/trip-resources.ts).
-- Additive only: a vendor register with each vendor's catalog, a vendor on
-- vehicles and personnel, the services staged for a trip, which events draw on
-- them, and the daily shift and odometer log that billing reads.
-- AlterTable
ALTER TABLE "public"."Vehicle" ADD COLUMN     "vendorId" INTEGER;

-- AlterTable
ALTER TABLE "public"."Personnel" ADD COLUMN     "vendorId" INTEGER;

-- CreateTable
CREATE TABLE "public"."Vendor" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VendorService" (
    "vendorId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorService_pkey" PRIMARY KEY ("vendorId","productId")
);

-- CreateTable
CREATE TABLE "public"."TripResource" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "vendorId" INTEGER,
    "productId" INTEGER,
    "vendorName" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "serviceCode" TEXT,
    "category" TEXT,
    "serviceClass" TEXT,
    "unitOfMeasure" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "resolution" TEXT,
    "billableHours" DECIMAL(8,2),
    "startOdometer" INTEGER,
    "endOdometer" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TripItemResource" (
    "itemId" INTEGER NOT NULL,
    "resourceId" INTEGER NOT NULL,

    CONSTRAINT "TripItemResource_pkey" PRIMARY KEY ("itemId","resourceId")
);

-- CreateTable
CREATE TABLE "public"."TripDayLog" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "dayId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "driverId" INTEGER,
    "officerId" INTEGER,
    "vehicleId" INTEGER,
    "label" TEXT NOT NULL,
    "shiftStart" TEXT,
    "shiftEnd" TEXT,
    "startOdometer" INTEGER,
    "endOdometer" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripDayLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "public"."Vendor"("name");

-- CreateIndex
CREATE INDEX "Vendor_status_idx" ON "public"."Vendor"("status");

-- CreateIndex
CREATE INDEX "VendorService_productId_idx" ON "public"."VendorService"("productId");

-- CreateIndex
CREATE INDEX "TripResource_tripId_idx" ON "public"."TripResource"("tripId");

-- CreateIndex
CREATE INDEX "TripResource_vendorId_idx" ON "public"."TripResource"("vendorId");

-- CreateIndex
CREATE INDEX "TripResource_productId_idx" ON "public"."TripResource"("productId");

-- CreateIndex
CREATE INDEX "TripItemResource_resourceId_idx" ON "public"."TripItemResource"("resourceId");

-- CreateIndex
CREATE INDEX "TripDayLog_tripId_idx" ON "public"."TripDayLog"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "TripDayLog_dayId_driverId_key" ON "public"."TripDayLog"("dayId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "TripDayLog_dayId_officerId_key" ON "public"."TripDayLog"("dayId", "officerId");

-- CreateIndex
CREATE UNIQUE INDEX "TripDayLog_dayId_vehicleId_key" ON "public"."TripDayLog"("dayId", "vehicleId");

-- CreateIndex
CREATE INDEX "Vehicle_vendorId_idx" ON "public"."Vehicle"("vendorId");

-- CreateIndex
CREATE INDEX "Personnel_vendorId_idx" ON "public"."Personnel"("vendorId");

-- AddForeignKey
ALTER TABLE "public"."Vendor" ADD CONSTRAINT "Vendor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorService" ADD CONSTRAINT "VendorService_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorService" ADD CONSTRAINT "VendorService_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripResource" ADD CONSTRAINT "TripResource_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripResource" ADD CONSTRAINT "TripResource_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripResource" ADD CONSTRAINT "TripResource_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripResource" ADD CONSTRAINT "TripResource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripResource" ADD CONSTRAINT "TripResource_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripItemResource" ADD CONSTRAINT "TripItemResource_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."TripItineraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripItemResource" ADD CONSTRAINT "TripItemResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "public"."TripResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripDayLog" ADD CONSTRAINT "TripDayLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripDayLog" ADD CONSTRAINT "TripDayLog_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "public"."TripDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripDayLog" ADD CONSTRAINT "TripDayLog_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripDayLog" ADD CONSTRAINT "TripDayLog_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "public"."Officer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripDayLog" ADD CONSTRAINT "TripDayLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripDayLog" ADD CONSTRAINT "TripDayLog_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Vehicle" ADD CONSTRAINT "Vehicle_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Personnel" ADD CONSTRAINT "Personnel_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

