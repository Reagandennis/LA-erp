-- AlterTable
ALTER TABLE "MessagingAccount" ADD COLUMN     "syncedUpTo" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessagingChat" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "chatId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'dm',
    "name" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessagingMessage" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "fromMe" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL,
    "mediaKind" TEXT,
    "mediaRef" TEXT,
    "mediaMime" TEXT,
    "mediaName" TEXT,
    "mediaSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessagingChat_accountId_lastMessageAt_idx" ON "MessagingChat"("accountId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingChat_accountId_chatId_key" ON "MessagingChat"("accountId", "chatId");

-- CreateIndex
CREATE INDEX "MessagingMessage_accountId_chatId_at_idx" ON "MessagingMessage"("accountId", "chatId", "at");

-- CreateIndex
CREATE INDEX "MessagingMessage_accountId_at_idx" ON "MessagingMessage"("accountId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingMessage_accountId_chatId_messageId_key" ON "MessagingMessage"("accountId", "chatId", "messageId");

-- AddForeignKey
ALTER TABLE "MessagingChat" ADD CONSTRAINT "MessagingChat_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MessagingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessagingMessage" ADD CONSTRAINT "MessagingMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MessagingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
