-- CreateTable
CREATE TABLE "PersonalTodoShare" (
    "id" SERIAL NOT NULL,
    "todoId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalTodoShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalTodoNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "todoId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "PersonalTodoNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalTodoShare_todoId_userId_key" ON "PersonalTodoShare"("todoId", "userId");

-- CreateIndex
CREATE INDEX "PersonalTodoShare_userId_createdAt_idx" ON "PersonalTodoShare"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PersonalTodoNotification_userId_createdAt_idx" ON "PersonalTodoNotification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PersonalTodoShare" ADD CONSTRAINT "PersonalTodoShare_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "PersonalTodo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTodoShare" ADD CONSTRAINT "PersonalTodoShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTodoNotification" ADD CONSTRAINT "PersonalTodoNotification_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "PersonalTodo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTodoNotification" ADD CONSTRAINT "PersonalTodoNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
