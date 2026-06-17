-- DropTable
DROP TABLE IF EXISTS "IntelReport";

-- CreateTable
CREATE TABLE "IntelAssessment" (
    "id" SERIAL NOT NULL,
    "location" TEXT NOT NULL,
    "formattedAddress" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "context" TEXT,
    "title" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'Moderate',
    "summary" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "mapImage" BYTEA,
    "mapImageMime" TEXT,
    "streetImage" BYTEA,
    "streetImageMime" TEXT,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Complete',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntelAssessment_riskLevel_idx" ON "IntelAssessment"("riskLevel");

-- CreateIndex
CREATE INDEX "IntelAssessment_createdAt_idx" ON "IntelAssessment"("createdAt");

-- AddForeignKey
ALTER TABLE "IntelAssessment" ADD CONSTRAINT "IntelAssessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
