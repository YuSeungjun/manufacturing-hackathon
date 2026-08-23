"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CONFIRMED_EVENT_PENALTY } from "@/lib/score";
import { assertManager } from "@/lib/auth";
import { fetchCapture } from "@/lib/aiClient";
import { extensionFor, storeEvidence, storeEvidenceBytes } from "@/lib/evidenceStore";
import { randomUUID } from "node:crypto";

function revalidateAll() {
  revalidatePath("/manager", "layout");
  revalidatePath("/operator", "layout");
  revalidatePath("/worker");
}

/**
 * 사람의 판단.
 *
 * 위험으로 확정되는 순간에만 AI 캡처를 Blob 으로 옮긴다.
 * AI 서비스의 캡처는 휘발성이다 — HF Space 는 재시작하면 디스크가 날아간다.
 * AI 의 의심은 휘발, 사람의 판단은 영구.
 *
 * **"위험 확정" 은 종결이 아니다.** 화면에서 "위험이다" 라고 판단한 시점과 현장을 처리하고
 * 종결한 시점은 다르다. 그래서 위험 확정은 사건을 `IN_PROGRESS`(진행 중) 로 옮기고,
 * 확정·패스는 진행 중인 사건 화면에서 내린다.
 *
 * 이걸 한 단계로 합치면 "확정" 이 두 가지 뜻을 갖는다 — 관리자가 화면에서 누른 것과
 * 현장이 실제로 처리된 것. 안전이행 점수가 감점되는 시점이 그 둘 중 어디인지 흐려진다.
 */
export type ReviewState =
  | null
  | { error: string }
  /** 진행 중으로 옮겼다. 화면이 그 페이지로 갈지 물어본다. */
  | { ok: true; movedToIncidents: true; message: string }
  | { ok: true; movedToIncidents: false; message: string };

export async function reviewRiskEventAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const manager = await assertManager();
  const riskEventId = String(formData.get("riskEventId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const comment = String(formData.get("comment") ?? "").slice(0, 500);

  if (!["CONFIRMED", "FALSE_POSITIVE", "HOLD"].includes(decision)) {
    return { error: "올바르지 않은 판단 값입니다." };
  }

  const event = await prisma.riskEvent.findFirst({
    where: { id: riskEventId, workplaceId: manager.workplaceId },
  });
  if (!event) return { error: "위험 사건을 찾을 수 없습니다." };

  // 위험 확정은 종결이 아니라 이송이다 — 진행 중인 사건으로 옮긴다.
  const moved = decision === "CONFIRMED";
  const patch: {
    status: string;
    acknowledgedAt?: Date;
    startedAt?: Date;
    evidencePath?: string;
    clipPath?: string;
  } = { status: moved ? "IN_PROGRESS" : decision };
  if (!event.acknowledgedAt) patch.acknowledgedAt = new Date();

  if (moved) {
    patch.startedAt = new Date();
    // 근거를 여기서 영구 보관으로 옮긴다. 진행 중으로 넘어간 뒤 AI 캡처가 날아가면
    // 현장에서 볼 사진이 없어진다 — 확정까지 기다릴 수 없다.
    const persisted = await persistCaptures(event.evidencePath, event.clipPath);
    if (persisted.evidencePath) patch.evidencePath = persisted.evidencePath;
    if (persisted.clipPath) patch.clipPath = persisted.clipPath;
  }

  await prisma.$transaction([
    prisma.riskEvent.update({ where: { id: event.id }, data: patch }),
    prisma.review.upsert({
      where: { riskEventId: event.id },
      create: { riskEventId: event.id, reviewedById: manager.id, decision, comment },
      update: { reviewedById: manager.id, decision, comment, reviewedAt: new Date() },
    }),
  ]);

  revalidateAll();

  if (moved) {
    return {
      ok: true,
      movedToIncidents: true,
      message: "진행 중인 사건으로 옮겼습니다.",
    };
  }
  return {
    ok: true,
    movedToIncidents: false,
    message: decision === "FALSE_POSITIVE" ? "오탐으로 종결했습니다." : "판단을 보류했습니다.",
  };
}

/**
 * 진행 중인 사건을 종결한다 — 벌점 부과 또는 현장 조치 완료.
 *
 * **벌점 부과** 실제 위험이었고 책임 있는 작업조에 점수를 깎는다. 조를 사람이 고른다.
 * **현장 조치 완료** 확인하고 처리했으며 벌점은 없다.
 *
 * 조를 설비로 추론하지 않는 이유 — 한 설비에 여러 조가 붙고, 정비 작업이 등록되지 않은
 * 조는 사건이 아무리 나도 점수가 안 깎인다. 누가 책임지는지는 추론이 아니라 사람이
 * 정하는 일이고, 점수를 깎는 행위는 특히 그렇다.
 *
 * 오탐과도 다르다. 오탐은 **AI 가 틀린 것**(정확도 지표의 분자)이고, 조치 완료는 AI 가
 * 맞게 잡았지만 **현장에서 처리해 벌점까지 갈 일이 아니었던 것**이다. 둘을 한 칸에 넣으면
 * 오탐율이 실제보다 나빠 보이고, 멀쩡한 모델을 의심하게 된다.
 */
export type ResolveState = null | { error: string } | { ok: true; message: string };

export async function resolveIncidentAction(
  _prev: ResolveState,
  formData: FormData,
): Promise<ResolveState> {
  const manager = await assertManager();
  const riskEventId = String(formData.get("riskEventId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const comment = String(formData.get("comment") ?? "").slice(0, 500);

  if (!["CONFIRMED", "PASSED"].includes(decision)) {
    return { error: "올바르지 않은 종결 값입니다." };
  }

  const event = await prisma.riskEvent.findFirst({
    where: { id: riskEventId, workplaceId: manager.workplaceId },
  });
  if (!event) return { error: "사건을 찾을 수 없습니다." };
  if (event.status !== "IN_PROGRESS") {
    return { error: "진행 중인 사건만 종결할 수 있습니다." };
  }

  // 벌점은 조를 정하지 않고 부과할 수 없다. 점수를 깎으면서 누구 점수인지 비워 두면
  // 나중에 아무도 그 감점을 설명할 수 없다.
  let chargedTeamId: string | null = null;
  let penaltyPoints = 0;
  if (decision === "CONFIRMED") {
    const teamId = String(formData.get("teamId") ?? "");
    if (!teamId) return { error: "벌점을 받을 작업조를 골라 주세요." };
    const team = await prisma.team.findFirst({
      where: { id: teamId, workplaceId: manager.workplaceId },
    });
    if (!team) return { error: "작업조를 찾을 수 없습니다." };
    chargedTeamId = team.id;
    penaltyPoints = CONFIRMED_EVENT_PENALTY;
  }

  await prisma.$transaction([
    prisma.riskEvent.update({
      where: { id: event.id },
      data: { status: decision, resolvedAt: new Date(), chargedTeamId, penaltyPoints },
    }),
    // 리뷰는 사람의 판단 기록이다. 종결 결론으로 갱신하되 언제 판단했는지는 새로 남긴다.
    prisma.review.upsert({
      where: { riskEventId: event.id },
      create: { riskEventId: event.id, reviewedById: manager.id, decision, comment },
      update: { reviewedById: manager.id, decision, comment, reviewedAt: new Date() },
    }),
  ]);

  revalidateAll();
  return {
    ok: true,
    message:
      decision === "CONFIRMED"
        ? `벌점 ${penaltyPoints}점을 부과했습니다.`
        : "현장 조치 완료로 종결했습니다.",
  };
}

/** AI 서비스에 있는 휘발성 캡처를 영구 저장소로 옮긴다. 실패해도 판정은 진행한다. */
async function persistCaptures(evidencePath: string, clipPath: string) {
  const out: { evidencePath?: string; clipPath?: string } = {};
  for (const [key, path] of [
    ["evidencePath", evidencePath],
    ["clipPath", clipPath],
  ] as const) {
    // 이미 영구 주소면(Blob URL 이거나 로컬 저장분) 손대지 않는다
    if (!path || !path.startsWith("/captures/")) continue;
    const fetched = await fetchCapture(path);
    if (!fetched) continue;
    out[key] = await storeEvidenceBytes(
      fetched.bytes,
      `${randomUUID()}.${extensionFor(fetched.contentType)}`,
      fetched.contentType,
    );
  }
  return out;
}

/** 관리자가 사건을 열어봤다. 조치 소요시간의 첫 구간이 여기서 끝난다. */
/**
 * 안전대 체결 확인.
 *
 * AI 도 착용과 체결을 추정한다(CameraSnapshot.hookVerdict). 그래도 이 칸은 남는다 —
 * **판정과 확정은 다르다.** 훅이 무엇에 걸렸는지(정격 앵커인가, 난간인가, 자기 D링인가)는
 * 픽셀에서 나오는 정보가 아니라서, 현장을 본 사람의 한 번이 화면 열 장보다 낫다.
 */
export async function confirmHarnessAction(formData: FormData) {
  const manager = await assertManager();
  const riskEventId = String(formData.get("riskEventId") ?? "");
  const status = String(formData.get("harnessStatus") ?? "");

  if (!["CONFIRMED", "MISSING", "PENDING"].includes(status)) {
    throw new Error("올바르지 않은 안전대 확인 값입니다.");
  }

  const event = await prisma.riskEvent.findFirst({
    where: { id: riskEventId, workplaceId: manager.workplaceId },
    include: { zone: { select: { requiresHarness: true } } },
  });
  if (!event) throw new Error("위험 사건을 찾을 수 없습니다.");
  if (!event.zone?.requiresHarness) {
    throw new Error("이 구역은 안전대 체결 확인 대상이 아닙니다.");
  }

  await prisma.riskEvent.update({
    where: { id: event.id },
    data: {
      harnessStatus: status,
      // PENDING 으로 되돌리면 확인 이력도 지운다. 확인하지 않은 상태와 구분돼야 한다.
      harnessCheckedAt: status === "PENDING" ? null : new Date(),
      harnessCheckedById: status === "PENDING" ? null : manager.id,
    },
  });

  revalidatePath("/manager", "layout");
}

export async function acknowledgeRiskEventAction(riskEventId: string) {
  const manager = await assertManager();
  await prisma.riskEvent.updateMany({
    where: { id: riskEventId, workplaceId: manager.workplaceId, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
}

/** 구역 이탈을 확인했다. 노출시간이 여기서 확정된다. */
export async function clearRiskEventAction(formData: FormData) {
  const manager = await assertManager();
  const riskEventId = String(formData.get("riskEventId") ?? "");
  const event = await prisma.riskEvent.findFirst({
    where: { id: riskEventId, workplaceId: manager.workplaceId },
  });
  if (!event) throw new Error("위험 사건을 찾을 수 없습니다.");
  if (!["CONFIRMED", "FALSE_POSITIVE"].includes(event.status)) {
    throw new Error("위험 확정 또는 오탐 판단을 먼저 완료해 주세요.");
  }
  if (event.clearedAt) return;

  const clearedAt = new Date();
  await prisma.riskEvent.update({
    where: { id: event.id },
    data: {
      clearedAt,
      dwellSec: Math.max(event.dwellSec, (clearedAt.getTime() - event.enteredAt.getTime()) / 1000),
    },
  });
  revalidateAll();
}

export type ReportState = null | { error: string } | { ok: true; message: string };

/**
 * AI 가 놓친 위험을 관리자가 직접 등록한다.
 *
 * 미탐율의 분자가 여기서 나온다. 이게 없으면 "오탐은 세는데 미탐은 안 센다"는
 * 흔한 자기기만에 빠진다.
 */
export async function reportMissedRiskAction(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const manager = await assertManager();
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const zoneId = String(formData.get("zoneId") ?? "") || null;
  const note = String(formData.get("note") ?? "").slice(0, 500);
  const dwellSec = Number(formData.get("dwellSec") ?? 0);

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, workplaceId: manager.workplaceId },
  });
  if (!equipment) return { error: "설비를 찾을 수 없습니다." };

  const file = formData.get("frame");
  let evidencePath = "";
  if (file instanceof File && file.size > 0) {
    evidencePath = await storeEvidence(file);
  }

  const now = new Date();
  const zone = zoneId ? await prisma.dangerZone.findFirst({ where: { id: zoneId, equipmentId } }) : null;

  await prisma.riskEvent.create({
    data: {
      workplaceId: manager.workplaceId,
      equipmentId: equipment.id,
      zoneId: zone?.id ?? null,
      source: "MANUAL",
      reportedById: manager.id,
      code: "MANUAL",
      level: "WARNING",
      reason: note || "안전관리자가 직접 등록한 위험 (AI 미탐)",
      enteredAt: now,
      detectedAt: now,
      dwellSec: Number.isFinite(dwellSec) ? dwellSec : 0,
      machineState: "STOPPED",
      evidencePath,
      zonePolygon: zone?.polygon ?? "[]",
      // 사람이 직접 올린 건이므로 판정은 이미 끝났다
      status: "CONFIRMED",
      notifiedAt: now,
      acknowledgedAt: now,
      modelRepo: "manual",
    },
  });

  revalidateAll();
  return { ok: true, message: "AI 미탐 건으로 기록했습니다. 미탐율 지표에 반영됩니다." };
}
