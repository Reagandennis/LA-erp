-- AlterTable
ALTER TABLE "public"."Contact" ADD COLUMN     "googleResourceName" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_googleResourceName_key" ON "public"."Contact"("googleResourceName");

-- CreateIndex
CREATE INDEX "Contact_source_idx" ON "public"."Contact"("source");

