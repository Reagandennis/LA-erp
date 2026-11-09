-- CreateTable
CREATE TABLE "public"."BulletinPost" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Announcement',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "authorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulletinPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BulletinRead" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulletinRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulletinPost_pinned_createdAt_idx" ON "public"."BulletinPost"("pinned", "createdAt");

-- CreateIndex
CREATE INDEX "BulletinPost_expiresAt_idx" ON "public"."BulletinPost"("expiresAt");

-- CreateIndex
CREATE INDEX "BulletinRead_userId_idx" ON "public"."BulletinRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BulletinRead_postId_userId_key" ON "public"."BulletinRead"("postId", "userId");

-- AddForeignKey
ALTER TABLE "public"."BulletinPost" ADD CONSTRAINT "BulletinPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BulletinRead" ADD CONSTRAINT "BulletinRead_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."BulletinPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BulletinRead" ADD CONSTRAINT "BulletinRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Register the module so it appears in the sidebar and can be granted; the
-- seed keeps it current afterwards.
INSERT INTO "public"."Module" ("slug", "name", "description", "category", "sortOrder", "createdAt", "updatedAt")
VALUES (
  'bulletin-board',
  'Bulletin Board',
  'Company notices and announcements for everyone — pin what matters, set an expiry, and see who has read it.',
  'Communication',
  10,
  now(),
  now()
)
ON CONFLICT ("slug") DO NOTHING;
