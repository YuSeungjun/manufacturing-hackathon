"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertManager } from "@/lib/auth";
import {
  AiServiceError,
  analyzeFrameZones,
  getJob,
  startVideoAnalysis,
  type MachineStatePoint,
} from "@/lib/aiClient";
import { parsePolygon, type RiskLevel } from "@/lib/zone";

export type StartAnalysisState =
  | null
  | { error: string }
  | { ok: true; analysisId: string; jobId: string };

/**
 * 영상 분석 시작.
 *
 * 영상은 이미 Blob 에 올라와 있고 여기에는 URL 만 온다 — Vercel Function 요청 본문이
 * 4.5MB 로 막혀 있어서 영상을 서버 액션으로 중계할 수 없다.
 */
export async function startVideoAnalysisAction(
  _prev: StartAnalysisState,
  formData: FormData,
): Promise<StartAnalysisState> {
  const manager = await assertManager();
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const videoUrl = String(formData.get("videoUrl") ?? "");
  if (!videoUrl) return { error: "분석할 영상을 먼저 올려 주세요." };

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, workplaceId: manager.workplaceId },
    include: {
      zones: { where: { active: true }, orderBy: { order: "asc" }, include: { camera: true } },
      cameras: true,
    },
  });
  if (!equipment) return { error: "설비를 찾을 수 없습니다." };
  if (equipment.zones.length === 0) {
    return { error: "이 설비에 위험구역이 없습니다. 먼저 위험구역을 그려 주세요." };
  }

  const machineStates = parseMachineStates(formData);

  let jobId: string;
  try {
    const started = await startVideoAnalysis({
      videoUrl,
      zones: equipment.zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        polygon: parsePolygon(zone.polygon),
        kind: zone.kind,
        dwellWarnSec: zone.dwellThresholdSec,
      })),
      machineStates,
    });
    jobId = started.jobId;
  } catch (error) {
    return {
      error: error instanceof AiServiceError ? error.message : "AI 분석을 시작하지 못했습니다.",
    };
  }

  const cameraId =
    String(formData.get("cameraId") ?? "") || equipment.zones[0]?.cameraId || equipment.cameras[0]?.id || null;

  const analysis = await prisma.videoAnalysis.create({
    data: {
      workplaceId: manager.workplaceId,
      equipmentId: equipment.id,
      cameraId,
      jobId,
      status: "RUNNING",
      videoPath: videoUrl,
      machineStates: JSON.stringify(machineStates),
      analyzedById: manager.id,
    },
  });

  revalidatePath("/manager", "layout");
  return { ok: true, analysisId: analysis.id, jobId };
}

/**
 * 설비 상태 타임라인.
 *
 * 실운영에서는 PLC / MES / LOTO 시건 시스템이 준다. 데모에서는 화면에서 입력받는다.
 * 이게 파라미터라서 설비가 실제로 재가동하는 영상이 없어도 재가동 순간을 재현할 수 있다.
 */
function parseMachineStates(formData: FormData): MachineStatePoint[] {
  const raw = String(formData.get("machineStates") ?? "");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as MachineStatePoint[];
    } catch {
      /* 아래 단순 입력으로 넘어간다 */
    }
  }
  const initial = String(formData.get("initialState") ?? "STOPPED") as MachineStatePoint["state"];
  const points: MachineStatePoint[] = [{ tSec: 0, state: initial }];
  const restartAt = Number(formData.get("restartAtSec"));
  if (Number.isFinite(restartAt) && restartAt > 0) {
    points.push({ tSec: restartAt, state: "RESTART_REQUESTED" });
    points.push({ tSec: restartAt + 1.5, state: "RUNNING" });
  }
  return points;
}

export type PersistState =
  | { status: "RUNNING"; progress: number; processedFrames: number; totalFrames: number }
  | { status: "DONE"; riskCount: number; criticalCount: number; blocked: boolean }
  | { status: "ERROR"; error: string };

/**
 * 폴링이 DONE 을 보면 부른다. 결과를 저장하고 필요하면 인터록을 건다.
 *
 * 여러 번 불려도 안전해야 한다 — 폴링 화면은 탭 전환이나 새로고침으로 쉽게 중복 호출된다.
 */
export async function persistAnalysisResultAction(analysisId: string): Promise<PersistState> {
  const manager = await assertManager();
  const analysis = await prisma.videoAnalysis.findFirst({
    where: { id: analysisId, workplaceId: manager.workplaceId },
    include: { equipment: true, riskEvents: { select: { id: true, level: true } } },
  });
  if (!analysis) return { status: "ERROR", error: "분석 기록을 찾을 수 없습니다." };

  if (analysis.status === "DONE") {
    return {
      status: "DONE",
      riskCount: analysis.riskEvents.length,
      criticalCount: analysis.riskEvents.filter((e) => e.level === "CRITICAL").length,
      blocked: analysis.equipment.interlock === "BLOCKED",
    };
  }

  let job;
  try {
    job = await getJob(analysis.jobId);
  } catch (error) {
    return {
      status: "ERROR",
      error: error instanceof AiServiceError ? error.message : "분석 상태를 확인하지 못했습니다.",
    };
  }

  if (job.status === "ERROR") {
    await prisma.videoAnalysis.update({
      where: { id: analysis.id },
      data: { status: "ERROR", error: job.error ?? "알 수 없는 오류" },
    });
    return { status: "ERROR", error: job.error ?? "분석에 실패했습니다." };
  }
  if (job.status !== "DONE" || !job.result) {
    return {
      status: "RUNNING",
      progress: job.progress,
      processedFrames: job.processedFrames,
      totalFrames: job.totalFrames,
    };
  }

  const result = job.result;
  const zones = await prisma.dangerZone.findMany({ where: { equipmentId: analysis.equipmentId } });
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const now = new Date();

  const events = result.events.filter((e) => e.level !== "INFO" && e.level !== "SAFE");

  await prisma.$transaction([
    prisma.videoAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "DONE",
        durationSec: result.videoDurationSec,
        sourceFps: result.sourceFps,
        sampledFps: result.sampledFps,
        frameCount: result.frameCount,
        timeline: JSON.stringify(result.frames),
        zoneStats: JSON.stringify(result.zoneStats),
        warnings: JSON.stringify(result.warnings),
        modelRepo: result.model,
        processingSec: result.processingSec,
      },
    }),
    ...events.map((event) => {
      const zone = zoneById.get(event.zoneId);
      const enteredAt = event.startedAt ? new Date(event.startedAt) : now;
      const frame = result.frames.find((f) => Math.abs(f.tSec - event.peakSec) < 0.5);
      return prisma.riskEvent.create({
        data: {
          workplaceId: analysis.workplaceId,
          equipmentId: analysis.equipmentId,
          zoneId: zone?.id ?? null,
          cameraId: analysis.cameraId,
          analysisId: analysis.id,
          source: "AI",
          code: event.code,
          level: event.level,
          reason: event.reason,
          enteredAt,
          // 감지 시각 = 진입 시각 + AI 가 위험이라고 말하기까지 걸린 영상 내 시간
          detectedAt: new Date(enteredAt.getTime() + (event.peakSec - event.startSec) * 1000),
          dwellSec: event.dwellSec,
          occupantsAtPeak: event.occupantsAtPeak,
          trackIds: JSON.stringify(event.trackIds),
          clipStartSec: event.startSec,
          clipEndSec: event.endSec,
          peakSec: event.peakSec,
          machineState: event.machineState,
          severity: zone?.severity ?? "HIGH",
          confidence: frame?.persons[0]?.confidence ?? 0,
          // AI 캡처는 휘발성이다. 사람이 위험으로 확정할 때 Blob 으로 옮긴다.
          evidencePath: event.captures.find((c) => c.kind === "frame")?.url ?? "",
          clipPath: event.captures.find((c) => c.kind === "clip")?.url ?? "",
          boxes: JSON.stringify(frame?.persons ?? []),
          zonePolygon: zone?.polygon ?? "[]",
          interlockEngaged: event.level === "CRITICAL",
          status: "PENDING",
          notifiedAt: now,
          modelRepo: result.model,
        },
      });
    }),
  ]);

  const criticalCount = events.filter((e) => e.level === "CRITICAL").length;
  if (criticalCount > 0 && analysis.equipment.interlock !== "BLOCKED") {
    await prisma.equipment.update({
      where: { id: analysis.equipmentId },
      data: {
        interlock: "BLOCKED",
        interlockReason: events.find((e) => e.level === "CRITICAL")!.reason,
        interlockedAt: now,
        clearedAt: null,
      },
    });
    await prisma.equipmentStateLog.create({
      data: {
        equipmentId: analysis.equipmentId,
        fromState: analysis.equipment.runState,
        toState: analysis.equipment.runState,
        cause: "AI_INTERLOCK",
        note: "영상 분석에서 잔류 중 재가동이 확인되어 인터록을 걸었습니다.",
      },
    });
  }

  revalidatePath("/manager", "layout");
  revalidatePath("/operator", "layout");
  revalidatePath("/worker");
  return {
    status: "DONE",
    riskCount: events.length,
    criticalCount,
    blocked: criticalCount > 0 || analysis.equipment.interlock === "BLOCKED",
  };
}

export type OccupancyState =
  | null
  | { error: string }
  | { ok: true; personCount: number; occupancy: Record<string, number>; level: RiskLevel };

/** 지금 이 순간 구역이 비어 있는지 프레임 한 장으로 확인한다. */
export async function checkOccupancyAction(
  _prev: OccupancyState,
  formData: FormData,
): Promise<OccupancyState> {
  const manager = await assertManager();
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const file = formData.get("frame");
  if (!(file instanceof File) || file.size === 0) return { error: "확인할 프레임을 선택해 주세요." };

  const zones = await prisma.dangerZone.findMany({
    where: { active: true, equipmentId, equipment: { workplaceId: manager.workplaceId } },
  });
  if (zones.length === 0) return { error: "이 설비에 위험구역이 없습니다." };

  try {
    const result = await analyzeFrameZones(
      file,
      zones.map((z) => ({
        id: z.id,
        name: z.name,
        polygon: parsePolygon(z.polygon),
        kind: z.kind,
        dwellWarnSec: z.dwellThresholdSec,
      })),
      "RESTART_REQUESTED",
    );
    return {
      ok: true,
      personCount: result.personCount,
      occupancy: result.occupancy,
      level: result.riskLevel,
    };
  } catch (error) {
    return { error: error instanceof AiServiceError ? error.message : "프레임 판정에 실패했습니다." };
  }
}
