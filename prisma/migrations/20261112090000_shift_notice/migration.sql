-- Shift planning: what each person was last emailed about their published
-- shifts, so a change emails only the difference with an updated calendar file.
-- Additive.

-- CreateTable
CREATE TABLE "public"."ShiftNotice" (
    "lineId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "welcomedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent" JSONB NOT NULL DEFAULT '{}',
    "lastSentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftNotice_pkey" PRIMARY KEY ("lineId")
);

-- AddForeignKey
ALTER TABLE "public"."ShiftNotice" ADD CONSTRAINT "ShiftNotice_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "public"."ShiftLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
