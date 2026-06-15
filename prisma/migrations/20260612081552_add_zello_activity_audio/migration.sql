-- AlterTable
ALTER TABLE "ZelloActivity" ADD COLUMN     "audio" BYTEA,
ADD COLUMN     "hasAudio" BOOLEAN NOT NULL DEFAULT false;
