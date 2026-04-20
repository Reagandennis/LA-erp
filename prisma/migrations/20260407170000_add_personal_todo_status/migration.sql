-- AlterTable
ALTER TABLE "PersonalTodo" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'Backlog';

-- CreateIndex
CREATE INDEX "PersonalTodo_userId_status_idx" ON "PersonalTodo"("userId", "status");
