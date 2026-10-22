-- CreateTable
CREATE TABLE "public"."TripItemTraveler" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "tripTravelerId" INTEGER NOT NULL,

    CONSTRAINT "TripItemTraveler_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripItemTraveler_tripTravelerId_idx" ON "public"."TripItemTraveler"("tripTravelerId");

-- CreateIndex
CREATE UNIQUE INDEX "TripItemTraveler_itemId_tripTravelerId_key" ON "public"."TripItemTraveler"("itemId", "tripTravelerId");

-- AddForeignKey
ALTER TABLE "public"."TripItemTraveler" ADD CONSTRAINT "TripItemTraveler_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."TripItineraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripItemTraveler" ADD CONSTRAINT "TripItemTraveler_tripTravelerId_fkey" FOREIGN KEY ("tripTravelerId") REFERENCES "public"."TripTraveler"("id") ON DELETE CASCADE ON UPDATE CASCADE;

