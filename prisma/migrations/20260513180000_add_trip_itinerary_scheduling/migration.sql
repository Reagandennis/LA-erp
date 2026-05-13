-- TripItineraryItem: scheduling + reminder fields
ALTER TABLE "TripItineraryItem"
  ADD COLUMN "scheduledAt"           TIMESTAMP(3),
  ADD COLUMN "durationMinutes"       INTEGER,
  ADD COLUMN "reminderMinutesBefore" INTEGER,
  ADD COLUMN "reminderAt"            TIMESTAMP(3),
  ADD COLUMN "reminderSentAt"        TIMESTAMP(3);

CREATE INDEX "TripItineraryItem_tripId_scheduledAt_idx" ON "TripItineraryItem"("tripId", "scheduledAt");
CREATE INDEX "TripItineraryItem_reminderAt_reminderSentAt_idx" ON "TripItineraryItem"("reminderAt", "reminderSentAt");

-- TripItineraryItemNotification: per-user reminder notifications
CREATE TABLE "TripItineraryItemNotification" (
    "id"        SERIAL NOT NULL,
    "userId"    INTEGER NOT NULL,
    "itemId"    INTEGER NOT NULL,
    "type"      TEXT NOT NULL,
    "message"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt"    TIMESTAMP(3),

    CONSTRAINT "TripItineraryItemNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TripItineraryItemNotification_userId_createdAt_idx" ON "TripItineraryItemNotification"("userId", "createdAt");

ALTER TABLE "TripItineraryItemNotification"
  ADD CONSTRAINT "TripItineraryItemNotification_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "TripItineraryItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TripItineraryItemNotification"
  ADD CONSTRAINT "TripItineraryItemNotification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
