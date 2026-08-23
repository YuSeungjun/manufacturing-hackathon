-- AlterTable
ALTER TABLE "CameraSnapshot" ADD COLUMN     "hookConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "hookVerdict" TEXT NOT NULL DEFAULT '';
