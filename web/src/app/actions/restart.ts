"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertOperator } from "@/lib/auth";
import { evaluateInterlock, logStateChange } from "@/lib/interlock";

export type RestartState =
  | null
  | { error: string }
  | {
      ok: true;
      decision: "ALLOWED" | "BLOCKED";
      requestId: string;
      reason: string;
      riskEventId?: string;
      lotoHolders: { name: string; employeeNumber: string }[];
      occupancy: number;
    };

function revalidateAll() {
  // 레일의 단계별 숫자는 layout 에서 계산된다.
  // type 없이 부르면 페이지만 갱신돼 레일이 옛날 숫자로 남는다.
  revalidatePath("/manager", "layout");
  revalidatePath("/operator", "layout");
  revalidatePath("/worker");
}

/**
 * 재가동 요청 → 인터록 판정 → 차단 또는 허용.
 *
 * 운전 담당자가 누르는 단 하나의 버튼이고, 이 앱의 심장이다.
 */
export async function requestRestartAction(
  _prev: RestartState,
  formData: FormData,
): Promise<RestartState> {
  const operator = await assertOperator();
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const reason = String(formData.get("reason") ?? "").slice(0, 300);

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, workplaceId: operator.workplaceId },
  });
  if (!equipment) return { error: "설비를 찾을 수 없습니다." };

  const verdict = await evaluateInterlock(equipment.id);

  const request = await prisma.restartRequest.create({
    data: {
      equipmentId: equipment.id,
      workplaceId: operator.workplaceId,
      requestedById: operator.id,
      reason,
      decision: verdict.decision,
      blockReason: verdict.decision === "BLOCKED" ? verdict.reason : "",
      blockedById: verdict.riskEventId ?? null,
      occupancyAtRequest: verdict.occupancy,
      outcome: "OPEN",
    },
  });

  if (verdict.decision === "BLOCKED") {
    if (equipment.interlock !== "BLOCKED") {
      await prisma.equipment.update({
        where: { id: equipment.id },
        data: {
          interlock: "BLOCKED",
          interlockReason: verdict.reason,
          interlockedAt: new Date(),
          clearedAt: null,
        },
      });
    }
    // 차단 근거가 될 위험 사건이 없으면(시건 미해제 등) 관리자 통보 큐에 올릴 건을 만든다.
    // 그렇지 않으면 운전 담당자는 막혔는데 관리자 화면에는 아무것도 안 뜬다.
    if (!verdict.riskEventId) {
      const now = new Date();
      const created = await prisma.riskEvent.create({
        data: {
          workplaceId: operator.workplaceId,
          equipmentId: equipment.id,
          source: "AI",
          code: "LOTO_MISSING",
          level: "WARNING",
          reason: verdict.reason,
          enteredAt: now,
          detectedAt: now,
          occupantsAtPeak: verdict.lotoHolders.length,
          machineState: "RESTART_REQUESTED",
          interlockEngaged: true,
          notifiedAt: now,
          modelRepo: "interlock",
        },
      });
      await prisma.restartRequest.update({
        where: { id: request.id },
        data: { blockedById: created.id },
      });
    }
    await logStateChange(
      equipment.id, equipment.runState, equipment.runState,
      "AI_INTERLOCK", operator.id, verdict.reason,
    );
  } else {
    // 같은 설비의 이전 차단 요청은 원인이 해소되어 새 요청으로 대체됐다.
    await prisma.restartRequest.updateMany({
      where: {
        equipmentId: equipment.id,
        decision: "BLOCKED",
        outcome: "OPEN",
        id: { not: request.id },
      },
      data: { outcome: "RESOLVED" },
    });
    await prisma.equipment.update({
      where: { id: equipment.id },
      data: { interlock: "CLEAR", interlockReason: "", clearedAt: new Date() },
    });
    await logStateChange(equipment.id, equipment.runState, equipment.runState, "OPERATOR", operator.id);
  }

  revalidateAll();
  return {
    ok: true,
    decision: verdict.decision,
    requestId: request.id,
    reason: verdict.reason,
    riskEventId: verdict.riskEventId,
    lotoHolders: verdict.lotoHolders,
    occupancy: verdict.occupancy,
  };
}

/** 실제로 재가동했다. 지표의 종점. */
export async function confirmRestartedAction(formData: FormData) {
  const operator = await assertOperator();
  const requestId = String(formData.get("requestId") ?? "");

  const request = await prisma.restartRequest.findFirst({
    where: { id: requestId, workplaceId: operator.workplaceId },
    include: { equipment: true },
  });
  if (!request) throw new Error("재가동 요청을 찾을 수 없습니다.");
  if (request.decision !== "ALLOWED" || request.outcome !== "OPEN") {
    throw new Error("재가동 가능한 요청이 아닙니다. 설비 화면에서 다시 요청해 주세요.");
  }

  const verdict = await evaluateInterlock(request.equipmentId);
  if (verdict.decision === "BLOCKED") {
    throw new Error(`아직 재가동할 수 없습니다. ${verdict.reason}`);
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.restartRequest.update({
      where: { id: request.id },
      data: { outcome: "RESTARTED", restartedAt: now },
    }),
    prisma.equipment.update({
      where: { id: request.equipmentId },
      data: { runState: "RUNNING", interlock: "CLEAR" },
    }),
  ]);
  await logStateChange(request.equipmentId, request.equipment.runState, "RUNNING", "OPERATOR", operator.id);
  revalidateAll();
}

/** 설비 상태를 직접 바꾼다. 정비 진입은 인터록을 함께 건다. */
export async function setEquipmentRunStateAction(formData: FormData) {
  const operator = await assertOperator();
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const runState = String(formData.get("runState") ?? "");
  if (!["RUNNING", "STOPPED", "MAINTENANCE"].includes(runState)) {
    throw new Error("올바르지 않은 설비 상태입니다.");
  }

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, workplaceId: operator.workplaceId },
  });
  if (!equipment) throw new Error("설비를 찾을 수 없습니다.");

  if (runState === "RUNNING") {
    const verdict = await evaluateInterlock(equipment.id);
    if (verdict.decision === "BLOCKED") {
      throw new Error(`재가동이 차단되어 있습니다. ${verdict.reason}`);
    }
  }

  await prisma.equipment.update({
    where: { id: equipment.id },
    data:
      runState === "MAINTENANCE"
        ? {
            runState,
            interlock: "BLOCKED",
            interlockReason: "정비 작업 진행 중",
            interlockedAt: new Date(),
          }
        : { runState },
  });
  await logStateChange(
    equipment.id, equipment.runState, runState,
    runState === "MAINTENANCE" ? "MAINTENANCE" : "OPERATOR", operator.id,
  );
  revalidateAll();
}
