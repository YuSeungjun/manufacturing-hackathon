-- AlterTable
ALTER TABLE "RiskEvent" ADD COLUMN     "chargedTeamId" TEXT,
ADD COLUMN     "penaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_chargedTeamId_fkey" FOREIGN KEY ("chargedTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
