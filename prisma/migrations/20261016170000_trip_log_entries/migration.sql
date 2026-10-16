-- CreateTable
CREATE TABLE "public"."TripLogEntry" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL,
    "detail" TEXT NOT NULL,
    "receivedFrom" TEXT,
    "actionItem" TEXT,
    "dutyController" TEXT,
    "comments" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripLogEntry_tripId_loggedAt_idx" ON "public"."TripLogEntry"("tripId", "loggedAt");

-- CreateIndex
CREATE INDEX "TripLogEntry_escalated_idx" ON "public"."TripLogEntry"("escalated");

-- AddForeignKey
ALTER TABLE "public"."TripLogEntry" ADD CONSTRAINT "TripLogEntry_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripLogEntry" ADD CONSTRAINT "TripLogEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

