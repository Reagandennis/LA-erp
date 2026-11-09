-- Chat state mirrored from WhatsApp: archived, pinned and muted-until.
ALTER TABLE "public"."MessagingChat" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mutedUntil" TIMESTAMP(3),
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;

-- WhatsApp Channels reached the mirror through the live webhook labelled as
-- direct chats (only the group suffix was recognised). Name them properly.
UPDATE "public"."MessagingChat" SET "kind" = 'channel' WHERE "chatId" LIKE '%@newsletter';
