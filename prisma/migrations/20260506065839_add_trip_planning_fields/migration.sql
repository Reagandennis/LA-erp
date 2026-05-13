-- AlterTable
ALTER TABLE "public"."Trip" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."TripItineraryItem" ADD COLUMN     "endLocation" TEXT,
ADD COLUMN     "itemType" TEXT NOT NULL DEFAULT 'Note',
ADD COLUMN     "startLocation" TEXT;
