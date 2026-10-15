-- CreateTable
CREATE TABLE "public"."RoleModule" (
    "id" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "moduleId" INTEGER NOT NULL,

    CONSTRAINT "RoleModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleModule_moduleId_idx" ON "public"."RoleModule"("moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleModule_roleId_moduleId_key" ON "public"."RoleModule"("roleId", "moduleId");

-- AddForeignKey
ALTER TABLE "public"."RoleModule" ADD CONSTRAINT "RoleModule_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoleModule" ADD CONSTRAINT "RoleModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "public"."Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

