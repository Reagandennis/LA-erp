-- CreateTable
CREATE TABLE "public"."BackupSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "serviceAccountJson" TEXT,
    "driveId" TEXT,
    "driveName" TEXT,
    "folderId" TEXT,
    "scheduleTime" TEXT NOT NULL DEFAULT '02:00',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "keepDaily" INTEGER NOT NULL DEFAULT 14,
    "keepWeekly" INTEGER NOT NULL DEFAULT 8,
    "keepMonthly" INTEGER NOT NULL DEFAULT 12,
    "includeDatabase" BOOLEAN NOT NULL DEFAULT true,
    "includeWhatsapp" BOOLEAN NOT NULL DEFAULT true,
    "includeWhatsappMedia" BOOLEAN NOT NULL DEFAULT false,
    "includeSignal" BOOLEAN NOT NULL DEFAULT true,
    "includeMediaCache" BOOLEAN NOT NULL DEFAULT true,
    "includeConfig" BOOLEAN NOT NULL DEFAULT true,
    "lockMonthly" BOOLEAN NOT NULL DEFAULT true,
    "encryptionKey" TEXT,
    "alertEmails" TEXT NOT NULL DEFAULT '',
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BackupRun" (
    "id" SERIAL NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "triggeredById" INTEGER,
    "folderId" TEXT,
    "folderName" TEXT,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "files" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "keyFingerprint" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifyError" TEXT,
    "prunedAt" TIMESTAMP(3),

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "public"."BackupRun"("startedAt");

-- CreateIndex
CREATE INDEX "BackupRun_status_prunedAt_idx" ON "public"."BackupRun"("status", "prunedAt");

