-- AlterTable
ALTER TABLE "public"."StoredFile" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
