-- CreateTable
CREATE TABLE "public"."TripShareLink" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "includeCrew" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripShareLink_tripId_key" ON "public"."TripShareLink"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "TripShareLink_token_key" ON "public"."TripShareLink"("token");

-- AddForeignKey
ALTER TABLE "public"."TripShareLink" ADD CONSTRAINT "TripShareLink_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripShareLink" ADD CONSTRAINT "TripShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

