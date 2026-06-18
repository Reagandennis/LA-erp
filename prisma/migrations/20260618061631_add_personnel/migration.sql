-- CreateTable
CREATE TABLE "public"."Personnel" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "department" TEXT NOT NULL DEFAULT 'Operations',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "location" TEXT,
    "manager" TEXT,
    "joinDate" TIMESTAMP(3),
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "userId" INTEGER,
    "photoName" TEXT,
    "photoMime" TEXT,
    "photoSize" INTEGER,
    "photoContent" BYTEA,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Personnel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Personnel_userId_key" ON "public"."Personnel"("userId");

-- CreateIndex
CREATE INDEX "Personnel_department_idx" ON "public"."Personnel"("department");

-- CreateIndex
CREATE INDEX "Personnel_status_idx" ON "public"."Personnel"("status");

-- CreateIndex
CREATE INDEX "Personnel_name_idx" ON "public"."Personnel"("name");

-- AddForeignKey
ALTER TABLE "public"."Personnel" ADD CONSTRAINT "Personnel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Personnel" ADD CONSTRAINT "Personnel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
