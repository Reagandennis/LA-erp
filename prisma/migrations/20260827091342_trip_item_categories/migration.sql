-- AlterTable
ALTER TABLE "TripItineraryItem" ADD COLUMN     "address" TEXT,
ADD COLUMN     "body" TEXT,
ADD COLUMN     "bookingUrl" TEXT,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'activity',
ADD COLUMN     "details" JSONB,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "placeName" TEXT,
ADD COLUMN     "providerName" TEXT,
ADD COLUMN     "timeLabel" TEXT;

-- CreateIndex
CREATE INDEX "TripItineraryItem_tripId_category_idx" ON "TripItineraryItem"("tripId", "category");

-- Map the legacy five-value `itemType` onto Travefy's categories.
-- `itemType` is deliberately kept for one release: it is the rollback path, and
-- `tripItemTypeSchema` still accepts it until every caller has migrated.
UPDATE "TripItineraryItem"
   SET "category" = CASE "itemType"
     WHEN 'flight'   THEN 'flight'
     WHEN 'car'      THEN 'transportation'
     WHEN 'hotel'    THEN 'lodging'
     WHEN 'location' THEN 'activity'
     WHEN 'activity' THEN 'activity'
     ELSE 'activity'
   END;

-- `subtitle` was doing the job of a description, an address and a notes field
-- all at once. Copy it into `body` so nothing is lost; `subtitle` becomes the
-- short one-line sub-label from here on.
UPDATE "TripItineraryItem"
   SET "body" = "subtitle"
 WHERE "subtitle" IS NOT NULL AND "subtitle" <> '';
