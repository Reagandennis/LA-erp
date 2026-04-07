-- CreateTable
CREATE TABLE "PersonalTodoAttachment" (
    "id" SERIAL NOT NULL,
    "todoId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalTodoAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalTodoAttachment_todoId_userId_idx" ON "PersonalTodoAttachment"("todoId", "userId");

-- CreateIndex
CREATE INDEX "PersonalTodoAttachment_userId_createdAt_idx" ON "PersonalTodoAttachment"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PersonalTodoAttachment" ADD CONSTRAINT "PersonalTodoAttachment_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "PersonalTodo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTodoAttachment" ADD CONSTRAINT "PersonalTodoAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
