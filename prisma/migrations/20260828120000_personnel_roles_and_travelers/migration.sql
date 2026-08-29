-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "personnelId" INTEGER,
ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DriverLicense" ADD COLUMN     "personnelId" INTEGER;

-- AlterTable
ALTER TABLE "Officer" ADD COLUMN     "personnelId" INTEGER,
ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Personnel" ADD COLUMN     "callSign" TEXT,
ADD COLUMN     "engagement" TEXT NOT NULL DEFAULT 'Employee',
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "supplierName" TEXT;

-- CreateTable
CREATE TABLE "Traveler" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" INTEGER,
    "email" TEXT,
    "phone" TEXT,
    "nationality" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "passportNumber" TEXT,
    "passportExpiry" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Active',
    "riskLevel" TEXT NOT NULL DEFAULT 'Standard',
    "dietaryNotes" TEXT,
    "medicalNotes" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "notes" TEXT,
    "photoName" TEXT,
    "photoMime" TEXT,
    "photoSize" INTEGER,
    "photoContent" BYTEA,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Traveler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripTraveler" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "travelerId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripTraveler_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Traveler_customerId_idx" ON "Traveler"("customerId");

-- CreateIndex
CREATE INDEX "Traveler_name_idx" ON "Traveler"("name");

-- CreateIndex
CREATE INDEX "Traveler_status_idx" ON "Traveler"("status");

-- CreateIndex
CREATE INDEX "Traveler_passportExpiry_idx" ON "Traveler"("passportExpiry");

-- CreateIndex
CREATE INDEX "TripTraveler_travelerId_idx" ON "TripTraveler"("travelerId");

-- CreateIndex
CREATE UNIQUE INDEX "TripTraveler_tripId_travelerId_key" ON "TripTraveler"("tripId", "travelerId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_personnelId_key" ON "Driver"("personnelId");

-- CreateIndex
CREATE INDEX "DriverLicense_personnelId_idx" ON "DriverLicense"("personnelId");

-- CreateIndex
CREATE UNIQUE INDEX "Officer_personnelId_key" ON "Officer"("personnelId");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Officer" ADD CONSTRAINT "Officer_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLicense" ADD CONSTRAINT "DriverLicense_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Traveler" ADD CONSTRAINT "Traveler_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Traveler" ADD CONSTRAINT "Traveler_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripTraveler" ADD CONSTRAINT "TripTraveler_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripTraveler" ADD CONSTRAINT "TripTraveler_travelerId_fkey" FOREIGN KEY ("travelerId") REFERENCES "Traveler"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- BACKFILL: fold the existing Officer / Driver / DriverLicense rows into
-- Personnel, which becomes the master people record.
--
-- Linking rule, applied identically everywhere: link only on an unambiguous
-- case-insensitive trimmed name match. Ambiguous rows are deliberately LEFT
-- UNLINKED (personnelId IS NULL) rather than guessed -- the Personnel and
-- compliance pages surface them for manual reconciliation. Name matching is
-- inherently imperfect; nothing here invents a link.
--
-- Officers run BEFORE drivers so that a person who is both is matched to the
-- row created in the officer pass and simply gains a second role, rather than
-- being duplicated.
-- ---------------------------------------------------------------------------

-- 1a. Officers: link to an existing, uniquely-named Personnel.
WITH cand AS (
  SELECT lower(btrim(name)) AS key, min(id) AS pid
  FROM "Personnel" GROUP BY 1 HAVING count(*) = 1
), pick AS (
  SELECT DISTINCT ON (c.pid) o.id AS oid, c.pid
  FROM "Officer" o JOIN cand c ON c.key = lower(btrim(o.name))
  WHERE o."personnelId" IS NULL
  ORDER BY c.pid, o.id
)
UPDATE "Officer" o SET "personnelId" = pick.pid FROM pick WHERE o.id = pick.oid;

-- 1b. Officers with no match: create the Personnel record, one per distinct name.
--     'Driver/CPO' is the pre-existing compound-string hack for multi-role; it
--     becomes a genuine two-role person here, with grade normalised to 'CPO'.
INSERT INTO "Personnel" (name, phone, roles, engagement, department, status,
                         "callSign", grade, "createdById", "createdAt", "updatedAt")
SELECT DISTINCT ON (lower(btrim(o.name)))
       btrim(o.name), o.phone,
       CASE WHEN o.grade = 'Driver/CPO' THEN ARRAY['CPO','Driver'] ELSE ARRAY['CPO'] END,
       'Employee', 'Security', 'Active',
       o."callSign",
       CASE WHEN o.grade = 'Driver/CPO' THEN 'CPO' ELSE o.grade END,
       o."createdById", now(), now()
FROM "Officer" o
WHERE o."personnelId" IS NULL
ORDER BY lower(btrim(o.name)), o.id;

-- 1c. Attach the officers to the rows just created.
WITH cand AS (
  SELECT lower(btrim(name)) AS key, min(id) AS pid
  FROM "Personnel" GROUP BY 1 HAVING count(*) = 1
), pick AS (
  SELECT DISTINCT ON (c.pid) o.id AS oid, c.pid
  FROM "Officer" o JOIN cand c ON c.key = lower(btrim(o.name))
  WHERE o."personnelId" IS NULL
  ORDER BY c.pid, o.id
)
UPDATE "Officer" o SET "personnelId" = pick.pid FROM pick WHERE o.id = pick.oid;

-- 2a. Drivers: link to an existing, uniquely-named Personnel (may be one the
--     officer pass just created -- that is exactly the CPO+Driver merge).
WITH cand AS (
  SELECT lower(btrim(name)) AS key, min(id) AS pid
  FROM "Personnel" GROUP BY 1 HAVING count(*) = 1
), pick AS (
  SELECT DISTINCT ON (c.pid) d.id AS did, c.pid
  FROM "Driver" d JOIN cand c ON c.key = lower(btrim(d.name))
  WHERE d."personnelId" IS NULL
  ORDER BY c.pid, d.id
)
UPDATE "Driver" d SET "personnelId" = pick.pid FROM pick WHERE d.id = pick.did;

-- 2b. Drivers with no match: create the Personnel record.
INSERT INTO "Personnel" (name, phone, roles, engagement, department, status,
                         "createdById", "createdAt", "updatedAt")
SELECT DISTINCT ON (lower(btrim(d.name)))
       btrim(d.name), d.phone, ARRAY['Driver'], 'Employee', 'Operations', 'Active',
       d."createdById", now(), now()
FROM "Driver" d
WHERE d."personnelId" IS NULL
ORDER BY lower(btrim(d.name)), d.id;

-- 2c. Attach the drivers to the rows just created.
WITH cand AS (
  SELECT lower(btrim(name)) AS key, min(id) AS pid
  FROM "Personnel" GROUP BY 1 HAVING count(*) = 1
), pick AS (
  SELECT DISTINCT ON (c.pid) d.id AS did, c.pid
  FROM "Driver" d JOIN cand c ON c.key = lower(btrim(d.name))
  WHERE d."personnelId" IS NULL
  ORDER BY c.pid, d.id
)
UPDATE "Driver" d SET "personnelId" = pick.pid FROM pick WHERE d.id = pick.did;

-- 3. Make the roles array reflect the mirror rows that now point at each person.
UPDATE "Personnel" p SET roles = array_append(p.roles, 'CPO')
WHERE EXISTS (SELECT 1 FROM "Officer" o WHERE o."personnelId" = p.id)
  AND NOT ('CPO' = ANY(p.roles));

UPDATE "Personnel" p SET roles = array_append(p.roles, 'Driver')
WHERE EXISTS (SELECT 1 FROM "Driver" d WHERE d."personnelId" = p.id)
  AND NOT ('Driver' = ANY(p.roles));

-- Carry the call sign / grade across for officers that matched a pre-existing
-- person (the insert above only covers newly-created rows).
UPDATE "Personnel" p
SET "callSign" = COALESCE(p."callSign", o."callSign"),
    grade      = COALESCE(p.grade, CASE WHEN o.grade = 'Driver/CPO' THEN 'CPO' ELSE o.grade END)
FROM "Officer" o
WHERE o."personnelId" = p.id;

-- Officers carrying the compound grade are now real two-role people.
UPDATE "Personnel" p SET roles = array_append(p.roles, 'Driver')
FROM "Officer" o
WHERE o."personnelId" = p.id AND o.grade = 'Driver/CPO'
  AND NOT ('Driver' = ANY(p.roles));

-- 4. Licences: MATCH ONLY, never create. driverName is free text and the least
--    trustworthy source, so an ambiguous name stays unlinked.
WITH cand AS (
  SELECT lower(btrim(name)) AS key, min(id) AS pid
  FROM "Personnel" GROUP BY 1 HAVING count(*) = 1
)
UPDATE "DriverLicense" l SET "personnelId" = c.pid
FROM cand c
WHERE l."personnelId" IS NULL AND c.key = lower(btrim(l."driverName"));

-- 5. A licence proves the Driver role.
UPDATE "Personnel" p SET roles = array_append(p.roles, 'Driver')
WHERE EXISTS (SELECT 1 FROM "DriverLicense" l WHERE l."personnelId" = p.id)
  AND NOT ('Driver' = ANY(p.roles));

-- 6. Re-denormalise driverName so the sync invariant (driverName = personnel.name)
--    holds from minute one. due-dates.ts / reports.ts / dashboard-highlights.ts
--    all read driverName, so it must never drift.
UPDATE "DriverLicense" l SET "driverName" = p.name
FROM "Personnel" p
WHERE p.id = l."personnelId" AND l."driverName" <> p.name;
