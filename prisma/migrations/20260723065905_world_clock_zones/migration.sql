-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "worldClockZones" TEXT[] DEFAULT ARRAY[]::TEXT[];
