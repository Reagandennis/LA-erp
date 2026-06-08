-- CreateTable
CREATE TABLE "DriverLicense" (
    "id" SERIAL NOT NULL,
    "driverName" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Class A',
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "lastVerified" TIMESTAMP(3),
    "notes" TEXT,
    "documentName" TEXT,
    "documentMime" TEXT,
    "documentSize" INTEGER,
    "documentContent" BYTEA,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverLicense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverLicense_expiryDate_idx" ON "DriverLicense"("expiryDate");

-- CreateIndex
CREATE INDEX "DriverLicense_driverName_idx" ON "DriverLicense"("driverName");

-- AddForeignKey
ALTER TABLE "DriverLicense" ADD CONSTRAINT "DriverLicense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
