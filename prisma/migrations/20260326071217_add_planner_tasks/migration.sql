-- CreateEnum
CREATE TYPE "public"."PlannerTaskType" AS ENUM ('personal', 'group');

-- CreateEnum
CREATE TYPE "public"."PlannerTaskStatus" AS ENUM ('todo', 'in_progress', 'blocked', 'done');

-- CreateEnum
CREATE TYPE "public"."PlannerTaskPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateTable
CREATE TABLE "public"."PlannerTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "taskType" "public"."PlannerTaskType" NOT NULL DEFAULT 'group',
    "status" "public"."PlannerTaskStatus" NOT NULL DEFAULT 'todo',
    "priority" "public"."PlannerTaskPriority" NOT NULL DEFAULT 'medium',
    "startAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "creatorUserId" INTEGER NOT NULL,
    "assigneeUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlannerTask_status_dueAt_idx" ON "public"."PlannerTask"("status", "dueAt");

-- CreateIndex
CREATE INDEX "PlannerTask_assigneeUserId_idx" ON "public"."PlannerTask"("assigneeUserId");

-- CreateIndex
CREATE INDEX "PlannerTask_taskType_startAt_dueAt_idx" ON "public"."PlannerTask"("taskType", "startAt", "dueAt");

-- AddForeignKey
ALTER TABLE "public"."PlannerTask" ADD CONSTRAINT "PlannerTask_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlannerTask" ADD CONSTRAINT "PlannerTask_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
