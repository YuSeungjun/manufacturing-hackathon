-- CreateTable
CREATE TABLE "CameraSnapshot" (
    "id" TEXT NOT NULL,
    "workplaceId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "imagePath" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL DEFAULT 'ZONE_APPROACH',
    "note" TEXT NOT NULL DEFAULT '',
    "lastAnalysisId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CameraSnapshot_workplaceId_capturedAt_idx" ON "CameraSnapshot"("workplaceId", "capturedAt");

-- CreateIndex
CREATE INDEX "CameraSnapshot_cameraId_capturedAt_idx" ON "CameraSnapshot"("cameraId", "capturedAt");

-- AddForeignKey
ALTER TABLE "CameraSnapshot" ADD CONSTRAINT "CameraSnapshot_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraSnapshot" ADD CONSTRAINT "CameraSnapshot_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "CameraFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraSnapshot" ADD CONSTRAINT "CameraSnapshot_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraSnapshot" ADD CONSTRAINT "CameraSnapshot_lastAnalysisId_fkey" FOREIGN KEY ("lastAnalysisId") REFERENCES "VideoAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
