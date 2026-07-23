-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "dashboardHighlights" TEXT[] DEFAULT ARRAY[]::TEXT[];
