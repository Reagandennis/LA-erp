-- AlterTable
ALTER TABLE "public"."Trip" ADD COLUMN     "country" TEXT;


-- Existing trips take their country from their reference ("MCF-KEN-OCT-2656",
-- or "MCF-X-KEN-JAN-1600"), including the codes used before the Standardized
-- Naming Master settled them. Mirrors parseTripReference in lib/trip-reference.ts.
UPDATE "public"."Trip"
SET "country" = CASE substring(upper(btrim("reference")) from '^[A-Z0-9]+-(?:X-)?([A-Z]{2,3})-')
  WHEN 'KEN' THEN 'Kenya'
  WHEN 'ETH' THEN 'Ethiopia'
  WHEN 'UGA' THEN 'Uganda'
  WHEN 'UG' THEN 'Uganda'
  WHEN 'TZA' THEN 'Tanzania'
  WHEN 'TZ' THEN 'Tanzania'
  WHEN 'NGA' THEN 'Nigeria'
  WHEN 'NIG' THEN 'Nigeria'
  WHEN 'NGR' THEN 'Nigeria'
  WHEN 'ZAF' THEN 'South Africa'
  WHEN 'SA' THEN 'South Africa'
  WHEN 'SSD' THEN 'South Sudan'
  WHEN 'RWA' THEN 'Rwanda'
  WHEN 'GHA' THEN 'Ghana'
  WHEN 'ZMB' THEN 'Zambia'
END
WHERE "country" IS NULL;
