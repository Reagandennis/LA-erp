-- Quote: shared cross-module tracking code
ALTER TABLE "Quote" ADD COLUMN "trackingCode" TEXT;
CREATE UNIQUE INDEX "Quote_trackingCode_key" ON "Quote"("trackingCode");
CREATE INDEX "Quote_trackingCode_idx" ON "Quote"("trackingCode");

-- Trip
CREATE TABLE "Trip" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "sourceQuoteId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "ownerId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Trip_reference_key" ON "Trip"("reference");
CREATE UNIQUE INDEX "Trip_trackingCode_key" ON "Trip"("trackingCode");
CREATE UNIQUE INDEX "Trip_sourceQuoteId_key" ON "Trip"("sourceQuoteId");
CREATE INDEX "Trip_createdById_status_idx" ON "Trip"("createdById", "status");
CREATE INDEX "Trip_ownerId_status_idx" ON "Trip"("ownerId", "status");
CREATE INDEX "Trip_customerId_idx" ON "Trip"("customerId");
CREATE INDEX "Trip_trackingCode_idx" ON "Trip"("trackingCode");

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TripItineraryItem
CREATE TABLE "TripItineraryItem" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(14,2),
    "completedAt" TIMESTAMP(3),
    "sourceQuoteItemId" INTEGER,

    CONSTRAINT "TripItineraryItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TripItineraryItem_tripId_position_idx" ON "TripItineraryItem"("tripId", "position");
CREATE INDEX "TripItineraryItem_sourceQuoteItemId_idx" ON "TripItineraryItem"("sourceQuoteItemId");

ALTER TABLE "TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_sourceQuoteItemId_fkey" FOREIGN KEY ("sourceQuoteItemId") REFERENCES "QuoteItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TripSequence (per-year non-skipping reference counter)
CREATE TABLE "TripSequence" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TripSequence_pkey" PRIMARY KEY ("year")
);

-- TrackingSequence (per-year non-skipping LA-… code counter)
CREATE TABLE "TrackingSequence" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrackingSequence_pkey" PRIMARY KEY ("year")
);
