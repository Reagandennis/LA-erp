-- Customer additions
ALTER TABLE "Customer" ADD COLUMN "billingAddress" TEXT;

-- Quote additions
ALTER TABLE "Quote" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Quote" ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Quote" ADD COLUMN "discountValue" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "tax" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "terms" TEXT;

-- Backfill tax for existing rows so total/subtotal stay consistent
UPDATE "Quote" SET "tax" = ROUND("subtotal" * "taxRate", 2);

-- QuoteItem additions
ALTER TABLE "QuoteItem" ADD COLUMN "taxable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "QuoteItem" ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "QuoteItem" ADD COLUMN "discountValue" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "QuoteItem" ADD COLUMN "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "QuoteItem" ADD COLUMN "productId" INTEGER;

-- Product
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "defaultUnitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Product_archived_name_idx" ON "Product"("archived", "name");
CREATE INDEX "Product_createdById_idx" ON "Product"("createdById");

ALTER TABLE "Product" ADD CONSTRAINT "Product_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- QuoteItem.productId FK + index (created after Product table)
CREATE INDEX "QuoteItem_productId_idx" ON "QuoteItem"("productId");
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- QuoteTemplate
CREATE TABLE "QuoteTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "terms" TEXT,
    "notes" TEXT,
    "discountType" TEXT NOT NULL DEFAULT 'none',
    "discountValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "items" JSONB NOT NULL DEFAULT '[]',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuoteTemplate_createdById_name_idx" ON "QuoteTemplate"("createdById", "name");

ALTER TABLE "QuoteTemplate" ADD CONSTRAINT "QuoteTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OrganizationSettings (singleton with id = 1)
CREATE TABLE "OrganizationSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "companyName" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "defaultTaxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "taxLabel" TEXT NOT NULL DEFAULT 'Tax',
    "logo" BYTEA,
    "logoMimeType" TEXT,
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- QuoteSequence — per-year sequential counter, no skips
CREATE TABLE "QuoteSequence" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteSequence_pkey" PRIMARY KEY ("year")
);

-- Backfill QuoteSequence from existing reference numbers so the next id continues the run
INSERT INTO "QuoteSequence" ("year", "lastNumber")
SELECT year::int, MAX(seq)::int
FROM (
  SELECT
    SPLIT_PART("reference", '-', 2) AS year,
    NULLIF(SPLIT_PART("reference", '-', 3), '')::int AS seq
  FROM "Quote"
  WHERE "reference" ~ '^QT-[0-9]+-[0-9]+$'
) AS parsed
GROUP BY year
ON CONFLICT ("year") DO NOTHING;
