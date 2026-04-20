-- CreateTable
CREATE TABLE "PersonalTodoComment" (
    "id" SERIAL NOT NULL,
    "todoId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalTodoComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalTodoComment_todoId_createdAt_idx" ON "PersonalTodoComment"("todoId", "createdAt");

-- CreateIndex
CREATE INDEX "PersonalTodoComment_userId_createdAt_idx" ON "PersonalTodoComment"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PersonalTodoComment" ADD CONSTRAINT "PersonalTodoComment_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "PersonalTodo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTodoComment" ADD CONSTRAINT "PersonalTodoComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
