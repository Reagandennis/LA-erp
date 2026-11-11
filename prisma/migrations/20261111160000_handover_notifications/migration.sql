-- A handover in the bell of someone on the incoming shift
-- (lib/handover-notifications.ts). Additive only: one new table.
-- CreateTable
CREATE TABLE "public"."HandoverNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "handoverId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'handover.new',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "HandoverNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoverNotification_userId_createdAt_idx" ON "public"."HandoverNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HandoverNotification_handoverId_idx" ON "public"."HandoverNotification"("handoverId");

-- AddForeignKey
ALTER TABLE "public"."HandoverNotification" ADD CONSTRAINT "HandoverNotification_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "public"."HandoverEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HandoverNotification" ADD CONSTRAINT "HandoverNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

