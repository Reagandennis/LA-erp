-- The map module now renders OpenStreetMap tiles instead of Google Maps.
-- `boundaryType` existed only to hold Google's data-driven boundary feature
-- layers (COUNTRY, ADMINISTRATIVE_AREA_LEVEL_1, ...), which have no equivalent
-- and were seeded automatically. Those placeholder rows carry no features and no
-- user data, so they go with the column.
--
-- Layers a user uploaded as reference borders have `kind = 'boundary'` and a NULL
-- `boundaryType`, so they are deliberately left untouched.
DELETE FROM "MapLayer" WHERE "boundaryType" IS NOT NULL;

DROP INDEX IF EXISTS "MapLayer_boundaryType_key";

ALTER TABLE "MapLayer" DROP COLUMN "boundaryType";
