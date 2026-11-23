-- Per-message state mirrored from WhatsApp: who sent it (for group reactions),
-- the reactions it has collected, and whether it was edited, deleted for
-- everyone, or forwarded.
ALTER TABLE "public"."MessagingMessage" ADD COLUMN     "senderJid" TEXT,
ADD COLUMN     "reactions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "edited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revoked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forwarded" BOOLEAN NOT NULL DEFAULT false;

-- Deleted messages were mirrored as a placeholder text only; flag them.
UPDATE "public"."MessagingMessage" SET "revoked" = true WHERE "text" = 'This message was deleted';
