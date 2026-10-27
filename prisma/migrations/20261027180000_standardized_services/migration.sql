-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN     "airportCode" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "coverageScope" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "quickbooksName" TEXT,
ADD COLUMN     "serviceClass" TEXT,
ADD COLUMN     "subCategory" TEXT,
ADD COLUMN     "terms" TEXT,
ADD COLUMN     "tier" TEXT,
ADD COLUMN     "unitOfMeasure" TEXT,
ADD COLUMN     "vehicleExamples" TEXT;

-- CreateTable
CREATE TABLE "public"."ServiceCatalogImport" (
    "version" TEXT NOT NULL,
    "created" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCatalogImport_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE INDEX "Product_sku_idx" ON "public"."Product"("sku");

