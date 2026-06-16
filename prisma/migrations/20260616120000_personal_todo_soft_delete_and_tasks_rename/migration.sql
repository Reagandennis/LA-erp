-- Soft delete for personal todos: keep deleted items so they remain visible/restorable.
-- AlterTable
ALTER TABLE "PersonalTodo" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PersonalTodo_userId_deletedAt_idx" ON "PersonalTodo"("userId", "deletedAt");

-- Rename the "To-do List Personal" module to "Tasks".
UPDATE "Module"
SET "name" = 'Tasks',
    "description" = 'Track your tasks, priorities, reminders, and follow-ups.'
WHERE "slug" = 'todo-personal';

-- Remove the unused "To-do List Group" module (UserModule rows cascade on delete).
DELETE FROM "Module" WHERE "slug" = 'todo-group';
