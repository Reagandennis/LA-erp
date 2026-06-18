-- CreateTable
CREATE TABLE "public"."Sop" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Operations',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "version" TEXT NOT NULL DEFAULT 'v1.0',
    "ownerName" TEXT,
    "description" TEXT,
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "effectiveDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SopAcknowledgement" (
    "id" SERIAL NOT NULL,
    "sopId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SopRevision" (
    "id" SERIAL NOT NULL,
    "sopId" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sop_code_key" ON "public"."Sop"("code");

-- CreateIndex
CREATE INDEX "Sop_status_idx" ON "public"."Sop"("status");

-- CreateIndex
CREATE INDEX "Sop_category_idx" ON "public"."Sop"("category");

-- CreateIndex
CREATE INDEX "Sop_reviewDate_idx" ON "public"."Sop"("reviewDate");

-- CreateIndex
CREATE INDEX "SopAcknowledgement_sopId_version_idx" ON "public"."SopAcknowledgement"("sopId", "version");

-- CreateIndex
CREATE INDEX "SopAcknowledgement_userId_idx" ON "public"."SopAcknowledgement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SopAcknowledgement_sopId_userId_version_key" ON "public"."SopAcknowledgement"("sopId", "userId", "version");

-- CreateIndex
CREATE INDEX "SopRevision_sopId_createdAt_idx" ON "public"."SopRevision"("sopId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Sop" ADD CONSTRAINT "Sop_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SopAcknowledgement" ADD CONSTRAINT "SopAcknowledgement_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "public"."Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SopAcknowledgement" ADD CONSTRAINT "SopAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SopRevision" ADD CONSTRAINT "SopRevision_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "public"."Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SopRevision" ADD CONSTRAINT "SopRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
