-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "brandProfileId" INTEGER;

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
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
    "logo" BYTEA,
    "logoMimeType" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#059669',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandProfile_archived_name_idx" ON "BrandProfile"("archived", "name");

-- CreateIndex
CREATE INDEX "BrandProfile_isDefault_idx" ON "BrandProfile"("isDefault");

-- CreateIndex
CREATE INDEX "Quote_brandProfileId_idx" ON "Quote"("brandProfileId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
