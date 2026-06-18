-- CreateTable
CREATE TABLE "public"."Contract" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "email" TEXT,
    "department" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Fixed Term',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "value" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lastRenewalDate" TIMESTAMP(3),
    "notes" TEXT,
    "documentName" TEXT,
    "documentMime" TEXT,
    "documentSize" INTEGER,
    "documentContent" BYTEA,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_reference_key" ON "public"."Contract"("reference");

-- CreateIndex
CREATE INDEX "Contract_endDate_idx" ON "public"."Contract"("endDate");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "public"."Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_counterpartyName_idx" ON "public"."Contract"("counterpartyName");

-- AddForeignKey
ALTER TABLE "public"."Contract" ADD CONSTRAINT "Contract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
