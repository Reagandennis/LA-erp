-- CreateTable
CREATE TABLE "public"."TripItemAttachment" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "thumbnail" BYTEA,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripItemAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripItemAttachment_itemId_createdAt_idx" ON "public"."TripItemAttachment"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "TripItemAttachment_uploadedById_idx" ON "public"."TripItemAttachment"("uploadedById");

-- AddForeignKey
ALTER TABLE "public"."TripItemAttachment" ADD CONSTRAINT "TripItemAttachment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."TripItineraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripItemAttachment" ADD CONSTRAINT "TripItemAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

