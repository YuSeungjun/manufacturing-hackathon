import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * 재가동 인터록 — 이 앱의 심장.
 *
 * 판정은 DB만 본다. AI 서비스가 죽어 있어도 이 함수는 답을 낸다.
 * 탐지가 멈췄다고 재가동이 자동으로 허용되면 안 되기 때문이다. (fail-safe)
 */

export type InterlockVerdict = {
  decision: "ALLOWED" | "BLOCKED";
  reason: string;
  /** 차단의 근거가 된 위험 사건 */
  riskEventId?: string;
  /** 아직 시건을 풀지 않은 작업자 */
  lotoHolders: { name: string; employeeNumber: string }[];
  /** 마지막으로 확인된 위험구역 잔류 인원 */
  occupancy: number;
};

export async function evaluateInterlock(equipmentId: string): Promise<InterlockVerdict> {
  const [openRisk, openWorks] = await Promise.all([
    // 아직 종결되지 않았고 오탐으로 판정되지도 않은 위험 사건
    prisma.riskEvent.findFirst({
      where: {
        equipmentId,
        clearedAt: null,
        status: { in: ["PENDING", "CONFIRMED", "HOLD"] },
      },
      orderBy: [{ detectedAt: "desc" }],
      include: { zone: true },
    }),
    prisma.maintenanceWork.findMany({
      where: { equipmentId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      include: { locks: { where: { releasedAt: null }, include: { user: true } } },
    }),
  ]);

  const lotoHolders = openWorks.flatMap((work) =>
    work.locks.map((lock) => ({
      name: lock.user.name,
      employeeNumber: lock.user.employeeNumber,
    })),
  );

  // 순서가 곧 안전 우선순위다. 사람이 안에 있다는 근거가 가장 앞선다.
  if (openRisk) {
    const zone = openRisk.zone?.name ?? "위험구역";
    return {
      decision: "BLOCKED",
      reason: `${zone}에서 종결되지 않은 위험 사건이 있습니다. 현장 확인 후 해제해 주세요.`,
      riskEventId: openRisk.id,
      lotoHolders,
      occupancy: openRisk.occupantsAtPeak,
    };
  }

  if (lotoHolders.length > 0) {
    const names = lotoHolders.map((h) => `${h.name}(${h.employeeNumber})`).join(", ");
    return {
      decision: "BLOCKED",
      reason: `개인 시건이 해제되지 않았습니다: ${names}`,
      lotoHolders,
      occupancy: 0,
    };
  }

  return { decision: "ALLOWED", reason: "위험구역이 비어 있고 시건이 모두 해제됐습니다.", lotoHolders, occupancy: 0 };
}

/** 설비 상태를 바꾸고 이력을 함께 남긴다. 이력이 없으면 지표를 만들 수 없다. */
export async function logStateChange(
  equipmentId: string,
  fromState: string,
  toState: string,
  cause: "AI_INTERLOCK" | "OPERATOR" | "MANAGER_CLEAR" | "MAINTENANCE",
  actorId?: string | null,
  note = "",
) {
  await prisma.equipmentStateLog.create({
    data: { equipmentId, fromState, toState, cause, actorId: actorId ?? null, note },
  });
}
