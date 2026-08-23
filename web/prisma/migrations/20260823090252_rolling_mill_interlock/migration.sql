-- 주제 전환: TBM/PPE 안전이행 → 압연설비 끼임 예방 인터록
--
-- 기존 Review 행은 곧 사라질 Detection 을 가리킨다. riskEventId 가 NOT NULL 이라
-- 그대로 두면 이 마이그레이션이 통과하지 못한다. PPE 판정 이력은 새 주제에서
-- 의미가 없으므로 비우고 간다.
DELETE FROM "Review";

-- DropForeignKey
ALTER TABLE "Detection" DROP CONSTRAINT "Detection_safetyRuleId_fkey";

-- DropForeignKey
ALTER TABLE "Detection" DROP CONSTRAINT "Detection_tbmId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_detectionId_fkey";

-- DropForeignKey
ALTER TABLE "SafetyRule" DROP CONSTRAINT "SafetyRule_tbmId_fkey";

-- DropForeignKey
ALTER TABLE "Tbm" DROP CONSTRAINT "Tbm_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Tbm" DROP CONSTRAINT "Tbm_teamId_fkey";

-- DropForeignKey
ALTER TABLE "Tbm" DROP CONSTRAINT "Tbm_workplaceId_fkey";

-- DropForeignKey
ALTER TABLE "TbmAcknowledgement" DROP CONSTRAINT "TbmAcknowledgement_tbmId_fkey";

-- DropForeignKey
ALTER TABLE "TbmAcknowledgement" DROP CONSTRAINT "TbmAcknowledgement_userId_fkey";

-- DropForeignKey
ALTER TABLE "TbmAssignee" DROP CONSTRAINT "TbmAssignee_tbmId_fkey";

-- DropForeignKey
ALTER TABLE "TbmAssignee" DROP CONSTRAINT "TbmAssignee_userId_fkey";

-- DropIndex
DROP INDEX "Review_detectionId_key";

-- AlterTable
ALTER TABLE "Review" DROP COLUMN "detectionId",
ADD COLUMN     "riskEventId" TEXT NOT NULL;

-- DropTable
DROP TABLE "Detection";

-- DropTable
DROP TABLE "SafetyRule";

-- DropTable
DROP TABLE "Tbm";

-- DropTable
DROP TABLE "TbmAcknowledgement";

-- DropTable
DROP TABLE "TbmAssignee";

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "line" TEXT NOT NULL DEFAULT '',
    "workplaceId" TEXT NOT NULL,
    "runState" TEXT NOT NULL DEFAULT 'STOPPED',
    "interlock" TEXT NOT NULL DEFAULT 'CLEAR',
    "interlockReason" TEXT NOT NULL DEFAULT '',
    "interlockedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DangerZone" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "cameraId" TEXT,
    "name" TEXT NOT NULL,
    "polygon" TEXT NOT NULL DEFAULT '[]',
    "dwellThresholdSec" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "kind" TEXT NOT NULL DEFAULT 'PINCH',
    "severity" TEXT NOT NULL DEFAULT 'HIGH',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DangerZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraFeed" (
    "id" TEXT NOT NULL,
    "workplaceId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "posterPath" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CameraFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceWork" (
    "id" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "equipmentId" TEXT NOT NULL,
    "workplaceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkAssignee" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "WorkAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotoLock" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "LotoLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAnalysis" (
    "id" TEXT NOT NULL,
    "workplaceId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "cameraId" TEXT,
    "jobId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT NOT NULL DEFAULT '',
    "videoPath" TEXT NOT NULL,
    "posterPath" TEXT NOT NULL DEFAULT '',
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceFps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampledFps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "timeline" TEXT NOT NULL DEFAULT '[]',
    "machineStates" TEXT NOT NULL DEFAULT '[]',
    "zoneStats" TEXT NOT NULL DEFAULT '[]',
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "modelRepo" TEXT NOT NULL DEFAULT '',
    "processingSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analyzedById" TEXT NOT NULL,

    CONSTRAINT "VideoAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "workplaceId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "zoneId" TEXT,
    "cameraId" TEXT,
    "analysisId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "reportedById" TEXT,
    "code" TEXT NOT NULL DEFAULT 'ZONE_INTRUSION',
    "level" TEXT NOT NULL DEFAULT 'CAUTION',
    "reason" TEXT NOT NULL DEFAULT '',
    "enteredAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "dwellSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "occupantsAtPeak" INTEGER NOT NULL DEFAULT 1,
    "trackIds" TEXT NOT NULL DEFAULT '[]',
    "clipStartSec" DOUBLE PRECISION,
    "clipEndSec" DOUBLE PRECISION,
    "peakSec" DOUBLE PRECISION,
    "machineState" TEXT NOT NULL DEFAULT 'STOPPED',
    "severity" TEXT NOT NULL DEFAULT 'HIGH',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidencePath" TEXT NOT NULL DEFAULT '',
    "clipPath" TEXT NOT NULL DEFAULT '',
    "boxes" TEXT NOT NULL DEFAULT '[]',
    "zonePolygon" TEXT NOT NULL DEFAULT '[]',
    "interlockEngaged" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notifiedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "modelRepo" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestartRequest" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "workplaceId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockReason" TEXT NOT NULL DEFAULT '',
    "blockedById" TEXT,
    "occupancyAtRequest" INTEGER NOT NULL DEFAULT 0,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT 'OPEN',
    "restartedAt" TIMESTAMP(3),

    CONSTRAINT "RestartRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentStateLog" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "EquipmentStateLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_workplaceId_code_key" ON "Equipment"("workplaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CameraFeed_workplaceId_code_key" ON "CameraFeed"("workplaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkAssignee_workId_userId_key" ON "WorkAssignee"("workId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LotoLock_workId_userId_key" ON "LotoLock"("workId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_riskEventId_key" ON "Review"("riskEventId");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DangerZone" ADD CONSTRAINT "DangerZone_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DangerZone" ADD CONSTRAINT "DangerZone_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "CameraFeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraFeed" ADD CONSTRAINT "CameraFeed_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraFeed" ADD CONSTRAINT "CameraFeed_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWork" ADD CONSTRAINT "MaintenanceWork_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWork" ADD CONSTRAINT "MaintenanceWork_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWork" ADD CONSTRAINT "MaintenanceWork_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWork" ADD CONSTRAINT "MaintenanceWork_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAssignee" ADD CONSTRAINT "WorkAssignee_workId_fkey" FOREIGN KEY ("workId") REFERENCES "MaintenanceWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAssignee" ADD CONSTRAINT "WorkAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotoLock" ADD CONSTRAINT "LotoLock_workId_fkey" FOREIGN KEY ("workId") REFERENCES "MaintenanceWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotoLock" ADD CONSTRAINT "LotoLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalysis" ADD CONSTRAINT "VideoAnalysis_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalysis" ADD CONSTRAINT "VideoAnalysis_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalysis" ADD CONSTRAINT "VideoAnalysis_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "CameraFeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalysis" ADD CONSTRAINT "VideoAnalysis_analyzedById_fkey" FOREIGN KEY ("analyzedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DangerZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "CameraFeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "VideoAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_riskEventId_fkey" FOREIGN KEY ("riskEventId") REFERENCES "RiskEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestartRequest" ADD CONSTRAINT "RestartRequest_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestartRequest" ADD CONSTRAINT "RestartRequest_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestartRequest" ADD CONSTRAINT "RestartRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestartRequest" ADD CONSTRAINT "RestartRequest_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "RiskEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestartRequest" ADD CONSTRAINT "RestartRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentStateLog" ADD CONSTRAINT "EquipmentStateLog_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentStateLog" ADD CONSTRAINT "EquipmentStateLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

