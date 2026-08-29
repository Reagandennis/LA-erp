-- AlterTable
ALTER TABLE "TripItineraryItem" ADD COLUMN     "dayId" INTEGER;

-- CreateTable
CREATE TABLE "TripDay" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "date" TIMESTAMP(3),
    "position" INTEGER NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripDay_tripId_position_idx" ON "TripDay"("tripId", "position");

-- CreateIndex
CREATE INDEX "TripDay_tripId_date_idx" ON "TripDay"("tripId", "date");

-- CreateIndex
CREATE INDEX "TripItineraryItem_dayId_position_idx" ON "TripItineraryItem"("dayId", "position");

-- AddForeignKey
ALTER TABLE "TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "TripDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDay" ADD CONSTRAINT "TripDay_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every existing scheduled item a persistent day.
--
-- Bucketing is deliberately UTC here, because that is exactly what the old
-- client-side `isoDateOnly` did (`toISOString().slice(0, 10)`). Reproducing it
-- means nothing appears to move on deploy. The local-vs-UTC day-boundary bug is
-- fixed for writes from here on, and any historical item that reads a day off
-- can simply be dragged into place.
INSERT INTO "TripDay" ("tripId", "date", "position", "createdAt", "updatedAt")
SELECT
  d."tripId",
  d."day",
  (ROW_NUMBER() OVER (PARTITION BY d."tripId" ORDER BY d."day"))::int - 1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT
    "tripId",
    date_trunc('day', "scheduledAt" AT TIME ZONE 'UTC') AS "day"
  FROM "TripItineraryItem"
  WHERE "scheduledAt" IS NOT NULL
) AS d;

-- Attach each scheduled item to the day it already appeared under.
UPDATE "TripItineraryItem" AS i
   SET "dayId" = td."id"
  FROM "TripDay" AS td
 WHERE td."tripId" = i."tripId"
   AND i."scheduledAt" IS NOT NULL
   AND td."date" = date_trunc('day', i."scheduledAt" AT TIME ZONE 'UTC');

-- Items with no schedule keep dayId NULL and stay in the Unscheduled tray.
