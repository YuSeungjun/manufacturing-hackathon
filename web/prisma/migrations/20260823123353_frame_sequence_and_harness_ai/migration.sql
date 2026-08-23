-- AlterTable
ALTER TABLE "RiskEvent" ADD COLUMN     "harnessAiConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "harnessAiStatus" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "VideoAnalysis" ADD COLUMN     "frameUrls" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "sourceKind" TEXT NOT NULL DEFAULT 'VIDEO';
