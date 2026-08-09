-- CreateTable
CREATE TABLE "public"."UploadLimitSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fileMb" INTEGER NOT NULL DEFAULT 25,
    "photoMb" INTEGER NOT NULL DEFAULT 8,
    "documentMb" INTEGER NOT NULL DEFAULT 10,
    "audioMb" INTEGER NOT NULL DEFAULT 12,
    "logoMb" INTEGER NOT NULL DEFAULT 1,
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadLimitSettings_pkey" PRIMARY KEY ("id")
);
