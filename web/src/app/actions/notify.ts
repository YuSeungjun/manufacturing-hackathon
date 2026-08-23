"use server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

/**
 * 관리자 화면 폴링용. 읽기 전용이라 revalidate 하지 않는다.
 *
 * REST 라우트를 늘리지 않으면서 "즉시 통보"를 만드는 가장 가벼운 방법이다.
 */
export async function pendingAlertsAction(): Promise<{
  riskPending: number;
  criticalPending: number;
  restartBlocked: number;
  latestRiskId: string | null;
}> {
  const user = await getSessionUser();
  if (!user || user.role !== "SAFETY_MANAGER") {
    return { riskPending: 0, criticalPending: 0, restartBlocked: 0, latestRiskId: null };
  }

  const [pending, restartBlocked, latest] = await Promise.all([
    prisma.riskEvent.findMany({
      where: { workplaceId: user.workplaceId, status: "PENDING" },
      select: { id: true, level: true },
    }),
    prisma.restartRequest.count({
      where: { workplaceId: user.workplaceId, decision: "BLOCKED", outcome: "OPEN", approvedAt: null },
    }),
    prisma.riskEvent.findFirst({
      where: { workplaceId: user.workplaceId, status: "PENDING" },
      orderBy: { detectedAt: "desc" },
      select: { id: true },
    }),
  ]);

  return {
    riskPending: pending.length,
    criticalPending: pending.filter((e) => e.level === "CRITICAL").length,
    restartBlocked,
    latestRiskId: latest?.id ?? null,
  };
}
