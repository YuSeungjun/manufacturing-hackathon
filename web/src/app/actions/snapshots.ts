"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertManager } from "@/lib/auth";
import { AiServiceError, analyzeHarness, startFrameAnalysis } from "@/lib/aiClient";
import { detectSnapshot, occupiedCount } from "@/lib/snapshotDetect";
import { parsePolygon } from "@/lib/zone";

export type SnapshotState = null | { error: string } | { ok: true; message: string; count: number };

export type AnalyzeSelectionState =
  | null
  | { error: string }
  | { ok: true; analysisId: string; jobId: string; frameCount: number };

const TRIGGERS = ["ZONE_APPROACH", "MOTION", "SCHEDULE", "MANUAL"] as const;

const ingestSchema = z.object({
  cameraId: z.string().min(1, "카메라를 골라 주세요."),
  trigger: z.enum(TRIGGERS).default("ZONE_APPROACH"),
  note: z.string().trim().max(200).default(""),
  intervalSec: z.coerce.number().int().min(1).max(3600).default(30),
});

/**
 * 스냅샷 수신.
 *
 * 실운영에서는 카메라·엣지 장치가 `POST /api/snapshots` 로 밀어 넣는다. 이 서버 액션은
 * 그 경로를 화면에서 흉내 내는 자리다 — 데모 이미지를 수신함에 넣기 위해서만 쓴다.
 *
 * 촬영 시각을 **여기서** 받는 것이 핵심이다. 분석할 때 받으면 매번 사람이 숫자를 넣어야
 * 하고 오타 하나가 잔류시간을 거짓으로 만든다. 찍힌 순간에 한 번 기록하면 그 뒤로는
 * 데이터다. 실제 카메라는 이 값을 스스로 안다.
 */
export async function ingestSnapshotsAction(
  _prev: SnapshotState,
  formData: FormData,
): Promise<SnapshotState> {
  const manager = await assertManager();

  const parsed = ingestSchema.safeParse({
    cameraId: formData.get("cameraId"),
    trigger: formData.get("trigger") ?? "ZONE_APPROACH",
    note: formData.get("note") ?? "",
    intervalSec: formData.get("intervalSec") ?? 30,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  }

  let images: { url: string; width: number; height: number }[] = [];
  try {
    const raw = JSON.parse(String(formData.get("images") ?? "[]"));
    if (Array.isArray(raw)) {
      images = raw
        .map((item) => ({
          url: String(item?.url ?? ""),
          width: Number(item?.width ?? 0) || 0,
          height: Number(item?.height ?? 0) || 0,
        }))
        .filter((item) => item.url);
    }
  } catch {
    return { error: "이미지 목록을 읽지 못했습니다." };
  }
  if (images.length === 0) return { error: "수신할 이미지를 먼저 올려 주세요." };

  const camera = await prisma.cameraFeed.findFirst({
    where: { id: parsed.data.cameraId, workplaceId: manager.workplaceId },
    include: {
      equipment: {
        include: { zones: { where: { active: true }, orderBy: { order: "asc" } } },
      },
    },
  });
  if (!camera) return { error: "카메라를 찾을 수 없습니다." };

  const zones = (camera.equipment?.zones ?? []).map((zone) => ({
    id: zone.id,
    name: zone.name,
    polygon: parsePolygon(zone.polygon),
    kind: zone.kind,
    dwellWarnSec: zone.dwellThresholdSec,
  }));

  // 첫 장의 시각. 비우면 지금부터 거꾸로 세어 넣는다 — 방금 찍힌 것처럼 보여야 데모가 자연스럽다.
  const rawFirst = String(formData.get("firstCapturedAt") ?? "");
  const interval = parsed.data.intervalSec;
  const first = rawFirst ? new Date(rawFirst) : null;
  const base =
    first && Number.isFinite(first.getTime())
      ? first
      : new Date(Date.now() - (images.length - 1) * interval * 1000);

  // 장면마다 1차 탐지를 붙인다. 순차로 도는 이유는 CPU 추론이라 병렬로 던지면
  // AI 서비스 안에서 어차피 줄을 서고 응답만 다 같이 늦어지기 때문이다.
  const rows = [];
  for (const [index, image] of images.entries()) {
    const detection = await detectSnapshot(image.url, zones);
    rows.push({
      workplaceId: manager.workplaceId,
      cameraId: camera.id,
      equipmentId: camera.equipmentId,
      imagePath: image.url,
      capturedAt: new Date(base.getTime() + index * interval * 1000),
      width: image.width,
      height: image.height,
      trigger: parsed.data.trigger,
      note: parsed.data.note,
      ...detection,
    });
  }
  await prisma.cameraSnapshot.createMany({ data: rows });

  const detected = rows.filter((row) => row.detectedAt != null).length;
  const approached = rows.filter((row) => occupiedCount(row.zoneOccupancy) > 0).length;

  revalidatePath("/manager", "layout");
  const detail =
    detected === 0
      ? " (AI 서비스에 닿지 못해 사람 탐지는 비어 있습니다)"
      : approached > 0
        ? ` · ${approached}장에서 위험구역 안 작업자를 찾았습니다`
        : " · 위험구역 안에서는 사람을 찾지 못했습니다";
  return {
    ok: true,
    message: `${images.length}장을 수신했습니다.${detail}`,
    count: images.length,
  };
}

/**
 * 이미지 주소를 절대 주소로 만든다.
 *
 * AI 서비스는 별도 프로세스(로컬 :8000, 배포는 HF Space)라서 `/evidence/...` 같은 상대
 * 경로를 받으면 아무것도 못 한다. Blob 이 켜져 있으면 이미 절대 주소지만, Blob 토큰이
 * 없는 환경에서는 public/evidence 에 저장되어 상대 경로가 된다 — 시드 스냅샷도 그렇다.
 */
async function toAbsolute(paths: string[]): Promise<string[]> {
  if (paths.every((path) => /^https?:\/\//i.test(path))) return paths;

  const store = await headers();
  const host = store.get("x-forwarded-host") ?? store.get("host");
  if (!host) {
    throw new Error("이미지 주소를 절대 주소로 바꿀 수 없습니다. 요청 호스트를 읽지 못했습니다.");
  }
  const proto = store.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  return paths.map((path) => (/^https?:\/\//i.test(path) ? path : new URL(path, origin).toString()));
}

/**
 * 수신함에서 고른 장면들을 한 시퀀스로 분석한다.
 *
 * 사람이 넣는 값이 없다 — 시각은 스냅샷에 붙어 있고, 구역은 설비에 그려져 있다.
 * 고르는 것만 사람이 한다.
 */
export async function analyzeSnapshotsAction(
  _prev: AnalyzeSelectionState,
  formData: FormData,
): Promise<AnalyzeSelectionState> {
  const manager = await assertManager();

  let ids: string[] = [];
  try {
    const raw = JSON.parse(String(formData.get("snapshotIds") ?? "[]"));
    if (Array.isArray(raw)) ids = raw.map(String).filter(Boolean);
  } catch {
    return { error: "선택 목록을 읽지 못했습니다." };
  }
  if (ids.length === 0) return { error: "분석할 장면을 골라 주세요." };

  const snapshots = await prisma.cameraSnapshot.findMany({
    where: { id: { in: ids }, workplaceId: manager.workplaceId },
    orderBy: { capturedAt: "asc" },
    include: { camera: true },
  });
  if (snapshots.length === 0) return { error: "고른 장면을 찾을 수 없습니다." };

  // 카메라가 섞이면 같은 좌표계가 아니다. 폴리곤은 화각에 종속되므로 판정이 무의미해진다.
  const cameraIds = new Set(snapshots.map((s) => s.cameraId));
  if (cameraIds.size > 1) {
    return { error: "한 번에 한 카메라의 장면만 분석할 수 있습니다. 위험구역이 화각마다 다릅니다." };
  }

  const equipmentId = snapshots[0].equipmentId ?? snapshots[0].camera.equipmentId;
  if (!equipmentId) {
    return { error: "이 카메라에 설비가 연결되지 않았습니다. 설비 관리에서 연결해 주세요." };
  }

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, workplaceId: manager.workplaceId },
    include: { zones: { where: { active: true }, orderBy: { order: "asc" } } },
  });
  if (!equipment) return { error: "설비를 찾을 수 없습니다." };
  if (equipment.zones.length === 0) {
    return { error: "이 설비에 위험구역이 없습니다. 먼저 위험구역을 그려 주세요." };
  }

  // 영상 내 초 = 첫 장으로부터 흐른 시간. 사람이 넣는 값이 아니다.
  const origin = snapshots[0].capturedAt.getTime();
  const frameTimes = snapshots.map((s) => (s.capturedAt.getTime() - origin) / 1000);

  // 같은 초가 두 장이면 어느 쪽이 먼저인지 알 수 없다. 여기서 막는다.
  if (new Set(frameTimes).size !== frameTimes.length) {
    return { error: "촬영 시각이 같은 장면이 섞여 있습니다. 하나만 골라 주세요." };
  }

  const machineStates = await machineStatesFor(equipment.id);

  let frameUrls: string[];
  try {
    frameUrls = await toAbsolute(snapshots.map((s) => s.imagePath));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "이미지 주소를 만들 수 없습니다." };
  }

  let jobId: string;
  try {
    const started = await startFrameAnalysis({
      frameUrls,
      frameTimes,
      zones: equipment.zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        polygon: parsePolygon(zone.polygon),
        kind: zone.kind,
        dwellWarnSec: zone.dwellThresholdSec,
      })),
      machineStates,
      // 사건 시각이 실제 촬영 시각이 된다. 분석을 언제 돌렸는지가 아니라.
      recordedAt: snapshots[0].capturedAt,
    });
    jobId = started.jobId;
  } catch (error) {
    return {
      error: error instanceof AiServiceError ? error.message : "AI 분석을 시작하지 못했습니다.",
    };
  }

  const analysis = await prisma.videoAnalysis.create({
    data: {
      workplaceId: manager.workplaceId,
      equipmentId: equipment.id,
      cameraId: snapshots[0].cameraId,
      jobId,
      status: "RUNNING",
      sourceKind: "FRAMES",
      frameUrls: JSON.stringify(snapshots.map((s) => s.imagePath)),
      videoPath: snapshots[0].imagePath,
      posterPath: snapshots[0].imagePath,
      machineStates: JSON.stringify(machineStates),
      analyzedById: manager.id,
    },
  });

  await prisma.cameraSnapshot.updateMany({
    where: { id: { in: snapshots.map((s) => s.id) } },
    data: { lastAnalysisId: analysis.id },
  });

  revalidatePath("/manager", "layout");
  return { ok: true, analysisId: analysis.id, jobId, frameCount: snapshots.length };
}

/**
 * 설비 상태 타임라인.
 *
 * 화면에서 받지 않는다 — **설비 기록에서 읽는다.** 실운영에서 이 값은 PLC 가 주는 것이고
 * 사람이 고를 자리가 아니다. 관리자에게 "이 장면 찍힐 때 설비가 돌고 있었나요" 를 물으면
 * 기억에 의존한 답이 판정의 근거가 된다.
 *
 * 매핑
 *   개인 시건이 하나라도 걸려 있으면  → LOTO   (정비 중이고 잠겨 있다)
 *   runState MAINTENANCE            → STOPPED (정비 중이지만 시건은 없다)
 *   runState RUNNING                → RUNNING (돌고 있다 — 구역 안에 사람이 있으면 위험)
 *   runState STOPPED                → STOPPED
 *
 * 한 점만 낸다. 시퀀스 중간의 재가동 시점은 PLC 신호가 들어와야 알 수 있고, 없는 것을
 * 화면에서 받아 채우면 그 시각이 판정의 근거가 된다.
 */
async function machineStatesFor(equipmentId: string) {
  const equipment = await prisma.equipment.findUniqueOrThrow({
    where: { id: equipmentId },
    select: {
      runState: true,
      works: {
        where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
        select: { locks: { where: { releasedAt: null }, select: { id: true } } },
      },
    },
  });

  const locked = equipment.works.some((work) => work.locks.length > 0);
  const state = locked
    ? "LOTO"
    : equipment.runState === "RUNNING"
      ? "RUNNING"
      : "STOPPED";

  return [{ tSec: 0, state } as const];
}

/** 수신함에서 지운다. 분석에 쓰인 장면은 근거라서 남긴다. */
export async function deleteSnapshotAction(formData: FormData) {
  const manager = await assertManager();
  const id = String(formData.get("snapshotId") ?? "");
  const snapshot = await prisma.cameraSnapshot.findFirst({
    where: { id, workplaceId: manager.workplaceId },
  });
  if (!snapshot) throw new Error("장면을 찾을 수 없습니다.");
  if (snapshot.lastAnalysisId) {
    throw new Error("이미 분석에 쓰인 장면은 지울 수 없습니다. 근거로 남아야 합니다.");
  }
  await prisma.cameraSnapshot.delete({ where: { id: snapshot.id } });
  revalidatePath("/manager", "layout");
}

export type HarnessRunState =
  | null
  | { error: string }
  | { ok: true; message: string; worn: number; notWorn: number; unknown: number };

/**
 * 안전대 착용 판정 — 고른 장면들에 대해.
 *
 * 위험구역 분석과 **별도 버튼**이다. 두 질문이 다르고 공급자도 다르다: 진입·잔류는 우리
 * 로직(사람 탐지 + 폴리곤)이고, 안전대 착용은 Roboflow 호스팅 추론이다. 한 버튼에 묶으면
 * 남의 서비스가 죽는 날 우리 판정까지 같이 의심받는다.
 *
 * 착용과 체결을 **따로** 받아 따로 저장한다. 근거의 강도가 달라서다 — 착용은 같은 장면에서
 * 안전대만 다른 A/B 쌍으로 확인했고, 체결은 미체결 표본 1장만 있다. 한 칸에 뭉치면 그
 * 차이가 사라진다.
 *
 * 어느 쪽도 **확정은 아니다.** 사건 검토 화면에 사람이 누르는 칸이 그대로 남는다.
 */
export async function analyzeHarnessAction(
  _prev: HarnessRunState,
  formData: FormData,
): Promise<HarnessRunState> {
  const manager = await assertManager();

  let ids: string[] = [];
  try {
    const raw = JSON.parse(String(formData.get("snapshotIds") ?? "[]"));
    if (Array.isArray(raw)) ids = raw.map(String).filter(Boolean);
  } catch {
    return { error: "선택 목록을 읽지 못했습니다." };
  }
  if (ids.length === 0) return { error: "판정할 장면을 골라 주세요." };

  const snapshots = await prisma.cameraSnapshot.findMany({
    where: { id: { in: ids }, workplaceId: manager.workplaceId },
    orderBy: { capturedAt: "asc" },
  });
  if (snapshots.length === 0) return { error: "고른 장면을 찾을 수 없습니다." };

  let urls: string[];
  try {
    urls = await toAbsolute(snapshots.map((s) => s.imagePath));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "이미지 주소를 만들 수 없습니다." };
  }

  let lastError = "";
  const tally = { WORN: 0, NOT_WORN: 0, UNKNOWN: 0 };
  const hookTally = { ATTACHED: 0, NOT_ATTACHED: 0, UNKNOWN: 0 };

  for (const [index, snapshot] of snapshots.entries()) {
    // 이미지를 다시 받아 온다. AI 서비스는 multipart 로만 프레임을 받는다.
    let file: File;
    try {
      const response = await fetch(urls[index], { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      file = new File([blob], "frame.jpg", { type: blob.type || "image/jpeg" });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "이미지를 받지 못했습니다.";
      continue;
    }

    try {
      const result = await analyzeHarness(file);
      if (result.error) lastError = result.error;
      tally[result.verdict] += 1;
      hookTally[result.hookVerdict] += 1;
      await prisma.cameraSnapshot.update({
        where: { id: snapshot.id },
        data: {
          harnessVerdict: result.verdict,
          harnessConfidence: result.confidence,
          hookVerdict: result.hookVerdict,
          hookConfidence: result.hookConfidence,
          harnessProvider: result.provider,
          harnessModel: result.model,
          harnessBoxes: JSON.stringify(result.persons),
          harnessAt: new Date(),
          harnessError: result.error,
        },
      });
    } catch (error) {
      lastError = error instanceof AiServiceError ? error.message : "안전대 판정에 실패했습니다.";
    }
  }

  revalidatePath("/manager", "layout");

  const judged = tally.WORN + tally.NOT_WORN;
  if (judged === 0) {
    return {
      error: lastError
        ? `안전대를 판정하지 못했습니다 — ${lastError}`
        : "안전대를 판정하지 못했습니다. 판정 공급자를 확인해 주세요.",
    };
  }
  const hookPart =
    hookTally.NOT_ATTACHED > 0
      ? ` · 훅 미체결 ${hookTally.NOT_ATTACHED}`
      : hookTally.ATTACHED > 0
        ? ` · 훅 체결 ${hookTally.ATTACHED}`
        : "";
  return {
    ok: true,
    message:
      `${snapshots.length}장 판정 — 착용 ${tally.WORN} · 미착용 의심 ${tally.NOT_WORN}` +
      (tally.UNKNOWN > 0 ? ` · 판정 불가 ${tally.UNKNOWN}` : "") +
      hookPart,
    worn: tally.WORN,
    notWorn: tally.NOT_WORN,
    unknown: tally.UNKNOWN,
  };
}
