-- AlterTable
ALTER TABLE "DangerZone" ADD COLUMN     "requiresHarness" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "downtimeCostPerMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CONVEYOR';

-- AlterTable
ALTER TABLE "RiskEvent" ADD COLUMN     "episodeId" TEXT,
ADD COLUMN     "harnessCheckedAt" TIMESTAMP(3),
ADD COLUMN     "harnessCheckedById" TEXT,
ADD COLUMN     "harnessStatus" TEXT NOT NULL DEFAULT 'NA';

-- CreateTable
CREATE TABLE "StoppageEpisode" (
    "id" TEXT NOT NULL,
    "workplaceId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "analysisId" TEXT,
    "cause" TEXT NOT NULL DEFAULT 'JAM',
    "source" TEXT NOT NULL DEFAULT 'AI',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "restartedAt" TIMESTAMP(3),
    "recoverySec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskApproach" BOOLEAN NOT NULL DEFAULT false,
    "approachCount" INTEGER NOT NULL DEFAULT 0,
    "approachDwellSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoppageEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoppageEpisode_equipmentId_startedAt_idx" ON "StoppageEpisode"("equipmentId", "startedAt");

-- CreateIndex
CREATE INDEX "StoppageEpisode_workplaceId_startedAt_idx" ON "StoppageEpisode"("workplaceId", "startedAt");

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_harnessCheckedById_fkey" FOREIGN KEY ("harnessCheckedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "StoppageEpisode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoppageEpisode" ADD CONSTRAINT "StoppageEpisode_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoppageEpisode" ADD CONSTRAINT "StoppageEpisode_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoppageEpisode" ADD CONSTRAINT "StoppageEpisode_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "VideoAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
