-- A Google-synced contact is private to whoever synced it, so its Google
-- resource name is unique per owner rather than across everyone: two people
-- may sync the same Google account. Indexes only; no rows change.
-- DropIndex
DROP INDEX "public"."Contact_googleResourceName_key";

-- CreateIndex
CREATE UNIQUE INDEX "Contact_createdById_googleResourceName_key" ON "public"."Contact"("createdById", "googleResourceName");

