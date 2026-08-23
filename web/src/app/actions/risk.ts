"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
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
 * 오탐으로 판정해도 인터록은 자동으로 풀리지 않는다. 해제는 approveRestartAction 만 한다.
 * 판정은 기록이고 해제는 조치다.
 */
export async function reviewRiskEventAction(formData: FormData) {
  const manager = await assertManager();
  const riskEventId = String(formData.get("riskEventId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const comment = String(formData.get("comment") ?? "").slice(0, 500);

  if (!["CONFIRMED", "FALSE_POSITIVE", "HOLD"].includes(decision)) {
    throw new Error("올바르지 않은 판단 값입니다.");
  }

  const event = await prisma.riskEvent.findFirst({
    where: { id: riskEventId, workplaceId: manager.workplaceId },
  });
  if (!event) throw new Error("위험 사건을 찾을 수 없습니다.");

  const patch: { status: string; acknowledgedAt?: Date; evidencePath?: string; clipPath?: string } = {
    status: decision,
  };
  if (!event.acknowledgedAt) patch.acknowledgedAt = new Date();

  if (decision === "CONFIRMED") {
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
