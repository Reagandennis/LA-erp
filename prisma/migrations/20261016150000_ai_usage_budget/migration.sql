-- CreateTable
CREATE TABLE "public"."AiUsage" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "userId" INTEGER,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "audioTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "thinkingTokens" INTEGER NOT NULL DEFAULT 0,
    "grounded" BOOLEAN NOT NULL DEFAULT false,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AiSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "monthlyBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "chatMessagesPerUserPerDay" INTEGER NOT NULL DEFAULT 60,
    "webSearchesPerDay" INTEGER NOT NULL DEFAULT 150,
    "intelReportsPerUserPerDay" INTEGER NOT NULL DEFAULT 10,
    "radioTranscription" BOOLEAN NOT NULL DEFAULT true,
    "alertEmails" TEXT NOT NULL DEFAULT '',
    "lastAlert" TEXT,
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsage_at_idx" ON "public"."AiUsage"("at");

-- CreateIndex
CREATE INDEX "AiUsage_feature_at_idx" ON "public"."AiUsage"("feature", "at");

-- CreateIndex
CREATE INDEX "AiUsage_userId_at_idx" ON "public"."AiUsage"("userId", "at");

