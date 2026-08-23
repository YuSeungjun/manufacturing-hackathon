-- AlterTable
ALTER TABLE "CameraSnapshot" ADD COLUMN     "boxes" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "detectedAt" TIMESTAMP(3),
ADD COLUMN     "modelRepo" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "personCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "riskLevel" TEXT NOT NULL DEFAULT 'SAFE',
ADD COLUMN     "zoneOccupancy" TEXT NOT NULL DEFAULT '{}';
