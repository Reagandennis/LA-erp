-- CreateEnum
CREATE TYPE "public"."PlannerTaskKind" AS ENUM ('task', 'folder');

-- AlterTable
ALTER TABLE "public"."PlannerTask" ADD COLUMN     "estimateMinutes" INTEGER,
ADD COLUMN     "kind" "public"."PlannerTaskKind" NOT NULL DEFAULT 'task',
ADD COLUMN     "parentTaskId" TEXT,
ADD COLUMN     "progressPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "PlannerTask_parentTaskId_sortOrder_idx" ON "public"."PlannerTask"("parentTaskId", "sortOrder");

-- AddForeignKey
ALTER TABLE "public"."PlannerTask" ADD CONSTRAINT "PlannerTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "public"."PlannerTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
