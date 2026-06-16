-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "photoContent" BYTEA,
ADD COLUMN     "photoMime" TEXT,
ADD COLUMN     "photoName" TEXT,
ADD COLUMN     "photoSize" INTEGER;

-- AlterTable
ALTER TABLE "Officer" ADD COLUMN     "photoContent" BYTEA,
ADD COLUMN     "photoMime" TEXT,
ADD COLUMN     "photoName" TEXT,
ADD COLUMN     "photoSize" INTEGER;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "photoContent" BYTEA,
ADD COLUMN     "photoMime" TEXT,
ADD COLUMN     "photoName" TEXT,
ADD COLUMN     "photoSize" INTEGER;
