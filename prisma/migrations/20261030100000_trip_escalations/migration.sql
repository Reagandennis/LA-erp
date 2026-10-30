-- AlterTable
ALTER TABLE "public"."OrganizationSettings" ADD COLUMN     "escalationRecipientIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "public"."TripLogNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "entryId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'trip.escalated',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "TripLogNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripLogNotification_userId_createdAt_idx" ON "public"."TripLogNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TripLogNotification_entryId_idx" ON "public"."TripLogNotification"("entryId");

-- AddForeignKey
ALTER TABLE "public"."TripLogNotification" ADD CONSTRAINT "TripLogNotification_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "public"."TripLogEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripLogNotification" ADD CONSTRAINT "TripLogNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

