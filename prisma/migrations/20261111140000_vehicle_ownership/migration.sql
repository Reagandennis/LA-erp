-- Whether a fleet vehicle is our own ("Internal") or a supplier's ("External").
-- Null on vehicles nobody has classified yet; additive only.
-- AlterTable
ALTER TABLE "public"."Vehicle" ADD COLUMN     "ownership" TEXT;
