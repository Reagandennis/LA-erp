-- CreateTable
CREATE TABLE "ZelloActivity" (
    "id" SERIAL NOT NULL,
    "network" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'in',
    "text" TEXT,
    "transcript" TEXT,
    "translation" TEXT,
    "language" TEXT,
    "durationMs" INTEGER,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" INTEGER,

    CONSTRAINT "ZelloActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZelloActivity_network_channel_at_idx" ON "ZelloActivity"("network", "channel", "at");

-- AddForeignKey
ALTER TABLE "ZelloActivity" ADD CONSTRAINT "ZelloActivity_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
