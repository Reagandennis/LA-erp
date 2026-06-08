-- CreateTable
CREATE TABLE "StoredFileShare" (
    "id" SERIAL NOT NULL,
    "fileId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFileShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "fileId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "FileNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoredFileShare_userId_idx" ON "StoredFileShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFileShare_fileId_userId_key" ON "StoredFileShare"("fileId", "userId");

-- CreateIndex
CREATE INDEX "FileNotification_userId_createdAt_idx" ON "FileNotification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "StoredFileShare" ADD CONSTRAINT "StoredFileShare_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFileShare" ADD CONSTRAINT "StoredFileShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileNotification" ADD CONSTRAINT "FileNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileNotification" ADD CONSTRAINT "FileNotification_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
