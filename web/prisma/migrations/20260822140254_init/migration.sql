-- CreateTable
CREATE TABLE "Workplace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "managerCode" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "workArea" TEXT NOT NULL,
    "workplaceId" TEXT NOT NULL,
    CONSTRAINT "Team_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'WORKER',
    "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
    "workplaceId" TEXT NOT NULL,
    "teamId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tbm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workDate" DATETIME NOT NULL,
    "workType" TEXT NOT NULL,
    "workArea" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdById" TEXT NOT NULL,
    "workplaceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tbm_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tbm_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tbm_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SafetyRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tbmId" TEXT NOT NULL,
    "hazard" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detectionType" TEXT NOT NULL DEFAULT 'MANUAL',
    "ppeCode" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "penalty" INTEGER NOT NULL DEFAULT 10,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SafetyRule_tbmId_fkey" FOREIGN KEY ("tbmId") REFERENCES "Tbm" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TbmAcknowledgement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tbmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TbmAcknowledgement_tbmId_fkey" FOREIGN KEY ("tbmId") REFERENCES "Tbm" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TbmAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Detection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tbmId" TEXT NOT NULL,
    "safetyRuleId" TEXT,
    "ppeCode" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CCTV',
    "evidencePath" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "boxes" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "modelRepo" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Detection_tbmId_fkey" FOREIGN KEY ("tbmId") REFERENCES "Tbm" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Detection_safetyRuleId_fkey" FOREIGN KEY ("safetyRuleId") REFERENCES "SafetyRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "detectionId" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_detectionId_fkey" FOREIGN KEY ("detectionId") REFERENCES "Detection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Workplace_name_key" ON "Workplace"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_workplaceId_name_key" ON "Team"("workplaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeNumber_key" ON "User"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TbmAcknowledgement_tbmId_userId_key" ON "TbmAcknowledgement"("tbmId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_detectionId_key" ON "Review"("detectionId");
