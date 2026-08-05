-- AlterTable
ALTER TABLE "public"."Customer" ADD COLUMN     "entity" TEXT NOT NULL DEFAULT 'LADYASKARI';

-- CreateTable
CREATE TABLE "public"."Deal" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'lead',
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "quoteId" INTEGER,
    "contractId" INTEGER,
    "signatureStatus" TEXT NOT NULL DEFAULT 'none',
    "expectedCloseDate" TIMESTAMP(3),
    "lostReason" TEXT,
    "notes" TEXT,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CrmActivity" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "dealId" INTEGER,
    "contactId" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'note',
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deal_stage_stageChangedAt_idx" ON "public"."Deal"("stage", "stageChangedAt");

-- CreateIndex
CREATE INDEX "Deal_customerId_idx" ON "public"."Deal"("customerId");

-- CreateIndex
CREATE INDEX "Deal_quoteId_idx" ON "public"."Deal"("quoteId");

-- CreateIndex
CREATE INDEX "CrmActivity_customerId_occurredAt_idx" ON "public"."CrmActivity"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmActivity_dealId_idx" ON "public"."CrmActivity"("dealId");

-- CreateIndex
CREATE INDEX "Customer_entity_idx" ON "public"."Customer"("entity");

-- AddForeignKey
ALTER TABLE "public"."Deal" ADD CONSTRAINT "Deal_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deal" ADD CONSTRAINT "Deal_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "public"."Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deal" ADD CONSTRAINT "Deal_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deal" ADD CONSTRAINT "Deal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmActivity" ADD CONSTRAINT "CrmActivity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmActivity" ADD CONSTRAINT "CrmActivity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "public"."Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmActivity" ADD CONSTRAINT "CrmActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmActivity" ADD CONSTRAINT "CrmActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
