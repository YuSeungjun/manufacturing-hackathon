-- AlterTable
ALTER TABLE "CameraSnapshot" ADD COLUMN     "harnessAt" TIMESTAMP(3),
ADD COLUMN     "harnessBoxes" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "harnessConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "harnessError" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "harnessModel" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "harnessProvider" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "harnessVerdict" TEXT NOT NULL DEFAULT '';
