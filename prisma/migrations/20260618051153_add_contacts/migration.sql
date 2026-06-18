-- CreateTable
CREATE TABLE "public"."Contact" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Client',
    "email" TEXT,
    "phone" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customerId" INTEGER,
    "photoName" TEXT,
    "photoMime" TEXT,
    "photoSize" INTEGER,
    "photoContent" BYTEA,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_createdById_createdAt_idx" ON "public"."Contact"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "Contact_category_idx" ON "public"."Contact"("category");

-- CreateIndex
CREATE INDEX "Contact_name_idx" ON "public"."Contact"("name");

-- AddForeignKey
ALTER TABLE "public"."Contact" ADD CONSTRAINT "Contact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contact" ADD CONSTRAINT "Contact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
