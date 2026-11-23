-- User groups: members see each other's trips (and may edit them) and to-dos
-- shared with the group. Additive.

-- CreateTable
CREATE TABLE "public"."UserGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserGroupMember" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PersonalTodoGroupShare" (
    "id" SERIAL NOT NULL,
    "todoId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalTodoGroupShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserGroup_name_key" ON "public"."UserGroup"("name");
CREATE UNIQUE INDEX "UserGroupMember_groupId_userId_key" ON "public"."UserGroupMember"("groupId", "userId");
CREATE INDEX "UserGroupMember_userId_idx" ON "public"."UserGroupMember"("userId");
CREATE UNIQUE INDEX "PersonalTodoGroupShare_todoId_groupId_key" ON "public"."PersonalTodoGroupShare"("todoId", "groupId");
CREATE INDEX "PersonalTodoGroupShare_groupId_idx" ON "public"."PersonalTodoGroupShare"("groupId");

-- AddForeignKey
ALTER TABLE "public"."UserGroupMember" ADD CONSTRAINT "UserGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."UserGroupMember" ADD CONSTRAINT "UserGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PersonalTodoGroupShare" ADD CONSTRAINT "PersonalTodoGroupShare_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "public"."PersonalTodo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PersonalTodoGroupShare" ADD CONSTRAINT "PersonalTodoGroupShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A WhatsApp number shared with a group (read and reply).
-- CreateTable
CREATE TABLE "public"."MessagingAccountGroupShare" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagingAccountGroupShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessagingAccountGroupShare_accountId_groupId_key" ON "public"."MessagingAccountGroupShare"("accountId", "groupId");
CREATE INDEX "MessagingAccountGroupShare_groupId_idx" ON "public"."MessagingAccountGroupShare"("groupId");

-- AddForeignKey
ALTER TABLE "public"."MessagingAccountGroupShare" ADD CONSTRAINT "MessagingAccountGroupShare_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."MessagingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."MessagingAccountGroupShare" ADD CONSTRAINT "MessagingAccountGroupShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
