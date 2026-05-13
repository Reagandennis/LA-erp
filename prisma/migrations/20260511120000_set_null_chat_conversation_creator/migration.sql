-- Preserve shared chat conversations when their creator is deleted.
ALTER TABLE "public"."ChatConversation" DROP CONSTRAINT "ChatConversation_createdById_fkey";

ALTER TABLE "public"."ChatConversation"
  ALTER COLUMN "createdById" DROP NOT NULL;

ALTER TABLE "public"."ChatConversation"
  ADD CONSTRAINT "ChatConversation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "public"."User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
