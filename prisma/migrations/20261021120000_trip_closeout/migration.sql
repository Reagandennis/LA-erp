-- CreateTable
CREATE TABLE "public"."TripCloseout" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "checks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "issues" TEXT,
    "clientFeedback" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripCloseout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripCloseout_tripId_key" ON "public"."TripCloseout"("tripId");

-- CreateIndex
CREATE INDEX "TripCloseout_closedAt_idx" ON "public"."TripCloseout"("closedAt");

-- AddForeignKey
ALTER TABLE "public"."TripCloseout" ADD CONSTRAINT "TripCloseout_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripCloseout" ADD CONSTRAINT "TripCloseout_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripCloseout" ADD CONSTRAINT "TripCloseout_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

