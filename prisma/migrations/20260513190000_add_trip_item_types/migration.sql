-- TripItineraryItem: typed item display fields
ALTER TABLE "TripItineraryItem"
  ADD COLUMN "itemType"         TEXT NOT NULL DEFAULT 'activity',
  ADD COLUMN "subtitle"         TEXT,
  ADD COLUMN "endsAt"           TIMESTAMP(3),
  ADD COLUMN "imageUrl"         TEXT,
  ADD COLUMN "confirmationCode" TEXT;
