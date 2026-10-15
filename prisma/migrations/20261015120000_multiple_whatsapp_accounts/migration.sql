-- DropIndex
DROP INDEX "public"."MessagingAccount_userId_provider_key";

-- CreateIndex
CREATE UNIQUE INDEX "MessagingAccount_userId_provider_handle_key" ON "public"."MessagingAccount"("userId", "provider", "handle");

