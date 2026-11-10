-- Shift planning rebuilt as a rotating roster (lib/shift-rules.ts).
-- The old pattern/team/shift/leave tables are replaced; PublicHoliday stays
-- and gains a country.

-- DropForeignKey
ALTER TABLE "public"."ShiftTemplate" DROP CONSTRAINT "ShiftTemplate_createdById_fkey";

-- DropForeignKey
ALTER TABLE "public"."Team" DROP CONSTRAINT "Team_createdById_fkey";

-- DropForeignKey
ALTER TABLE "public"."TeamMember" DROP CONSTRAINT "TeamMember_teamId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TeamMember" DROP CONSTRAINT "TeamMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ShiftTemplateMember" DROP CONSTRAINT "ShiftTemplateMember_templateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ShiftTemplateMember" DROP CONSTRAINT "ShiftTemplateMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ShiftTemplateTeam" DROP CONSTRAINT "ShiftTemplateTeam_templateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ShiftTemplateTeam" DROP CONSTRAINT "ShiftTemplateTeam_teamId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LeaveRequest" DROP CONSTRAINT "LeaveRequest_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LeaveRequest" DROP CONSTRAINT "LeaveRequest_decidedById_fkey";

-- DropForeignKey
ALTER TABLE "public"."ScheduleShift" DROP CONSTRAINT "ScheduleShift_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ScheduleShift" DROP CONSTRAINT "ScheduleShift_templateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ScheduleShift" DROP CONSTRAINT "ScheduleShift_createdById_fkey";

-- AlterTable
ALTER TABLE "public"."PublicHoliday" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'KE';

-- DropTable
DROP TABLE "public"."ShiftTemplate";

-- DropTable
DROP TABLE "public"."Team";

-- DropTable
DROP TABLE "public"."TeamMember";

-- DropTable
DROP TABLE "public"."ShiftTemplateMember";

-- DropTable
DROP TABLE "public"."ShiftTemplateTeam";

-- DropTable
DROP TABLE "public"."LeaveRequest";

-- DropTable
DROP TABLE "public"."ScheduleShift";

-- CreateTable
CREATE TABLE "public"."ShiftConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "rotationStart" TEXT NOT NULL,
    "pattern" TEXT[],
    "codes" JSONB NOT NULL,
    "targetHours7d" INTEGER NOT NULL DEFAULT 48,
    "maxHours7d" INTEGER NOT NULL DEFAULT 52,
    "maxHours14d" INTEGER NOT NULL DEFAULT 116,
    "minRestHours" INTEGER NOT NULL DEFAULT 11,
    "maxConsecutiveDuties" INTEGER NOT NULL DEFAULT 6,
    "leaveCapDays" INTEGER NOT NULL DEFAULT 14,
    "responseMinutes" INTEGER NOT NULL DEFAULT 60,
    "publishLeadDays" INTEGER NOT NULL DEFAULT 14,
    "weekStart" INTEGER NOT NULL DEFAULT 1,
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShiftLine" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "userId" INTEGER,
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'line',
    "cycleOffset" INTEGER,
    "startDate" TEXT,
    "endDate" TEXT,
    "contractHoursPerWeek" DOUBLE PRECISION NOT NULL DEFAULT 48,
    "leaveEntitlementDays" DOUBLE PRECISION NOT NULL DEFAULT 21,
    "leaveOpeningBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShiftMonth" (
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "publishedById" INTEGER,

    CONSTRAINT "ShiftMonth_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "public"."ShiftRecord" (
    "id" SERIAL NOT NULL,
    "lineId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "generatedCode" TEXT NOT NULL,
    "plannedCode" TEXT NOT NULL,
    "workedCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "plannedStart" TEXT,
    "plannedEnd" TEXT,
    "actualStart" TEXT,
    "actualEnd" TEXT,
    "hoursWorked" DOUBLE PRECISION,
    "reasonCode" TEXT,
    "note" TEXT,
    "approvedById" INTEGER,
    "leaveId" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShiftCallIn" (
    "id" SERIAL NOT NULL,
    "recordId" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "calledById" INTEGER,
    "calledAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "responseMinutes" INTEGER,
    "escalationApprovedById" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftCallIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShiftLeave" (
    "id" SERIAL NOT NULL,
    "lineId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'annual',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "shiftsCharged" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "requestedById" INTEGER,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShiftAudit" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" INTEGER,
    "actorName" TEXT NOT NULL,
    "month" TEXT,
    "lineCode" TEXT,
    "date" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "blockOverridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftLine_code_key" ON "public"."ShiftLine"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftLine_userId_key" ON "public"."ShiftLine"("userId");

-- CreateIndex
CREATE INDEX "ShiftLine_active_sortOrder_idx" ON "public"."ShiftLine"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "ShiftRecord_date_idx" ON "public"."ShiftRecord"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRecord_lineId_date_key" ON "public"."ShiftRecord"("lineId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCallIn_recordId_key" ON "public"."ShiftCallIn"("recordId");

-- CreateIndex
CREATE INDEX "ShiftLeave_lineId_startDate_idx" ON "public"."ShiftLeave"("lineId", "startDate");

-- CreateIndex
CREATE INDEX "ShiftLeave_status_idx" ON "public"."ShiftLeave"("status");

-- CreateIndex
CREATE INDEX "ShiftAudit_createdAt_idx" ON "public"."ShiftAudit"("createdAt");

-- CreateIndex
CREATE INDEX "ShiftAudit_month_idx" ON "public"."ShiftAudit"("month");

-- AddForeignKey
ALTER TABLE "public"."ShiftLine" ADD CONSTRAINT "ShiftLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShiftRecord" ADD CONSTRAINT "ShiftRecord_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "public"."ShiftLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShiftCallIn" ADD CONSTRAINT "ShiftCallIn_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "public"."ShiftRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShiftLeave" ADD CONSTRAINT "ShiftLeave_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "public"."ShiftLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Register the admin module so it appears in the access lists and can be
-- granted to a scheduler; the seed keeps both rows current afterwards.
INSERT INTO "public"."Module" ("slug", "name", "description", "category", "sortOrder", "createdAt", "updatedAt")
VALUES (
  'shift-planning-admin',
  'Shift Planning Admin',
  'Build and publish the roster: rotation, people, overrides, call-ins, leave, holidays, rules, and the audit log.',
  'Time',
  39,
  now(),
  now()
)
ON CONFLICT ("slug") DO NOTHING;

UPDATE "public"."Module"
SET "description" = 'Your shifts at a glance: what you are on today, what is next, your month, and your leave.',
    "updatedAt" = now()
WHERE "slug" = 'shift-planning';
