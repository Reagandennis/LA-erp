-- AlterTable
ALTER TABLE "public"."Customer" ADD COLUMN     "quickbooksCustomerId" TEXT;

-- AlterTable
ALTER TABLE "public"."Invoice" ADD COLUMN     "quickbooksInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "public"."InvoicePayment" ADD COLUMN     "quickbooksPaymentId" TEXT,
ADD COLUMN     "quickbooksSyncError" TEXT;

-- CreateTable
CREATE TABLE "public"."QuickBooksConnection" (
    "id" SERIAL NOT NULL,
    "realmId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "connectedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksConnection_realmId_key" ON "public"."QuickBooksConnection"("realmId");

-- AddForeignKey
ALTER TABLE "public"."QuickBooksConnection" ADD CONSTRAINT "QuickBooksConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
