/*
  Warnings:

  - You are about to drop the `TelegramSession` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "TelegramSession" DROP CONSTRAINT "TelegramSession_connectedById_fkey";

-- DropTable
DROP TABLE "TelegramSession";

-- CreateTable
CREATE TABLE "MessagingAccount" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "label" TEXT,
    "session" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessagingAccount_provider_idx" ON "MessagingAccount"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingAccount_userId_provider_key" ON "MessagingAccount"("userId", "provider");

-- AddForeignKey
ALTER TABLE "MessagingAccount" ADD CONSTRAINT "MessagingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
