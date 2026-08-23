"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertManager, assertOperator } from "@/lib/auth";
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

/**
 * 현장 확인 후 해제 승인. 인터록을 푸는 유일한 경로다.
 *
 * 위험 사건을 오탐으로 판정해도 인터록은 자동으로 풀리지 않는다.
 * 판정은 기록이고 해제는 조치다. 두 행동을 분리한다.
 */
export async function approveRestartAction(formData: FormData) {
  const manager = await assertManager();
  const requestId = String(formData.get("requestId") ?? "");
  const note = String(formData.get("approvalNote") ?? "").slice(0, 300);

  const request = await prisma.restartRequest.findFirst({
    where: { id: requestId, workplaceId: manager.workplaceId },
    include: { blockedBy: true, equipment: true },
  });
  if (!request) throw new Error("재가동 요청을 찾을 수 없습니다.");
  if (request.decision !== "BLOCKED") throw new Error("차단되지 않은 요청입니다.");
  if (request.approvedAt) throw new Error("이미 승인된 요청입니다.");

  // 가드 ① — AI 가 올린 건을 사람이 아직 안 봤으면 승인할 수 없다
  if (request.blockedBy && request.blockedBy.status === "PENDING") {
    throw new Error("먼저 위험 사건을 확정 또는 오탐으로 판단해 주세요.");
  }

  // 가드 ② — 개인 시건은 관리자도 대신 풀 수 없다. 건 사람만 푼다.
  const openLocks = await prisma.lotoLock.count({
    where: {
      releasedAt: null,
      work: { equipmentId: request.equipmentId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    },
  });
  if (openLocks > 0) {
    throw new Error(`개인 시건 ${openLocks}건이 해제되지 않았습니다. 작업자 본인이 해제해야 합니다.`);
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.restartRequest.update({
      where: { id: request.id },
      data: { approvedById: manager.id, approvedAt: now, approvalNote: note },
    }),
    prisma.equipment.update({
      where: { id: request.equipmentId },
      data: { interlock: "CLEAR", interlockReason: "", clearedAt: now },
    }),
    // 인터록을 걸었던 사건은 여기서 종결된다 — 노출시간의 끝점이다
    prisma.riskEvent.updateMany({
      where: { equipmentId: request.equipmentId, clearedAt: null, interlockEngaged: true },
      data: { clearedAt: now },
    }),
  ]);
  await logStateChange(
    request.equipmentId, request.equipment.runState, request.equipment.runState,
    "MANAGER_CLEAR", manager.id, note,
  );

  revalidateAll();
}

export async function rejectRestartAction(formData: FormData) {
  const manager = await assertManager();
  const requestId = String(formData.get("requestId") ?? "");
  const note = String(formData.get("approvalNote") ?? "").slice(0, 300);

  const request = await prisma.restartRequest.findFirst({
    where: { id: requestId, workplaceId: manager.workplaceId },
  });
  if (!request) throw new Error("재가동 요청을 찾을 수 없습니다.");

  await prisma.restartRequest.update({
    where: { id: request.id },
    data: { outcome: "REJECTED", approvalNote: note, approvedById: manager.id },
  });
  revalidateAll();
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
