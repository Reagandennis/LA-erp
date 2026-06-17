-- CreateTable
CREATE TABLE "IntelReport" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Threat',
    "severity" TEXT NOT NULL DEFAULT 'Medium',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "location" TEXT,
    "source" TEXT,
    "details" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntelReport_severity_idx" ON "IntelReport"("severity");

-- CreateIndex
CREATE INDEX "IntelReport_status_idx" ON "IntelReport"("status");

-- CreateIndex
CREATE INDEX "IntelReport_category_idx" ON "IntelReport"("category");

-- CreateIndex
CREATE INDEX "IntelReport_reportedAt_idx" ON "IntelReport"("reportedAt");

-- AddForeignKey
ALTER TABLE "IntelReport" ADD CONSTRAINT "IntelReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
