-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "accountingProvider" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "waveCustomerId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "waveInvoiceId" TEXT,
ADD COLUMN     "waveSyncError" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "waveEstimateId" TEXT,
ADD COLUMN     "waveSyncError" TEXT;

-- CreateTable
CREATE TABLE "WaveConnection" (
    "id" SERIAL NOT NULL,
    "businessId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "connectedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaveConnection_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "WaveConnection" ADD CONSTRAINT "WaveConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
