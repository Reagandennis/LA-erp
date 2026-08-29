-- Move TripDay onto date keys and dense day numbers.
--
-- `date DateTime` is replaced by `dateKey TEXT` holding "YYYY-MM-DD". Prisma
-- returns a date column as UTC midnight, which reads as the previous day
-- anywhere west of Greenwich — the same class of bug that made the old
-- itinerary bucket items into the wrong day. A date key round-trips unchanged
-- in every timezone and sorts lexicographically. Matches ScheduleShift.date.
--
-- `position` (0-based) becomes `dayNumber` (dense 1..N), which also serves as
-- the "Day 3" label for trips whose dates are still TBD.
--
-- Written to preserve data: the new columns are added nullable, backfilled from
-- the old ones, and only then made NOT NULL. Safe on a populated table.

ALTER TABLE "TripDay" ADD COLUMN "dateKey" TEXT;
ALTER TABLE "TripDay" ADD COLUMN "dayNumber" INTEGER;

UPDATE "TripDay"
   SET "dateKey"   = to_char("date", 'YYYY-MM-DD'),
       "dayNumber" = "position" + 1;

-- Any row that somehow escaped the backfill still needs a number.
UPDATE "TripDay" d
   SET "dayNumber" = s.rn
  FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tripId" ORDER BY "date" NULLS LAST, "id") AS rn
      FROM "TripDay"
  ) AS s
 WHERE d."id" = s."id" AND d."dayNumber" IS NULL;

ALTER TABLE "TripDay" ALTER COLUMN "dayNumber" SET NOT NULL;

DROP INDEX "TripDay_tripId_date_idx";
DROP INDEX "TripDay_tripId_position_idx";

ALTER TABLE "TripDay" DROP COLUMN "date";
ALTER TABLE "TripDay" DROP COLUMN "position";

CREATE INDEX "TripDay_tripId_dayNumber_idx" ON "TripDay"("tripId", "dayNumber");
CREATE INDEX "TripDay_tripId_dateKey_idx" ON "TripDay"("tripId", "dateKey");
