"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertManager } from "@/lib/auth";
import {
  AiServiceError,
  analyzeFrameZones,
  getJob,
  type MachineStatePoint,
} from "@/lib/aiClient";
import { parsePolygon, type RiskLevel, type TrackBox } from "@/lib/zone";
import { atSec, overlapsInterval, recordingBase, stoppageIntervals } from "@/lib/episodes";

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

  /**
   * SAFE 만 버린다. 사건이 아니라 "아무 일도 없었다" 는 뜻이기 때문이다.
   *
   * INFO 는 남긴다 — 시건(LOTO)을 걸고 들어간 정상 작업이다. ai/risk.py 는 이걸
   * "기록은 남기되 경보는 아니다" 로 정의하는데, 전에는 여기서 통째로 버려서
   * 기록조차 남지 않았다. 그래서 컨베이어를 분석해도 사건이 0건으로 보였다.
   * 대신 판정 대기(PENDING)로는 올리지 않는다 — 정상 작업까지 사람이 판단할 이유는 없다.
   */
  const events = result.events.filter((e) => e.level !== "SAFE");

  /**
   * 같은 순간의 같은 사건은 다시 만들지 않는다.
   *
   * 장면을 다시 분석했다고 그 순간이 두 번 일어난 건 아니다. 그런데 재분석마다 새 사건이
   * 생기면 검토 대기가 같은 사건의 복사본으로 채워지고, 관리자는 같은 장면을 몇 번씩
   * 판단하게 된다 — 그러면 큐 자체를 안 믿는다.
   *
   * 자연키는 (사업장, 설비, 구역, 코드, 진입시각) 이다. 진입시각은 AI 가 촬영 시각을
   * 받았을 때만 실제 벽시계 시각이 되므로(`startedAt`), **그때만** 중복으로 본다.
   * 촬영 시각 없이 돌린 분석은 매번 now 라서 같은 순간인지 알 수 없고, 알 수 없는 것을
   * 같다고 처리하면 서로 다른 사건이 조용히 합쳐진다.
   */
  const anchored = events
    .map((event) => ({ event, zone: zoneById.get(event.zoneId) }))
    .filter((item) => item.event.startedAt != null);

  const priorEvents =
    anchored.length === 0
      ? []
      : await prisma.riskEvent.findMany({
          where: {
            OR: anchored.map(({ event, zone }) => ({
              workplaceId: analysis.workplaceId,
              equipmentId: analysis.equipmentId,
              zoneId: zone?.id ?? null,
              code: event.code,
              enteredAt: new Date(event.startedAt!),
            })),
          },
        });

  const priorByKey = new Map(
    priorEvents.map((row) => [
      `${row.zoneId}|${row.code}|${row.enteredAt.toISOString()}`,
      row,
    ]),
  );

  /**
   * 정지 이미지 분석에는 캡처가 없다.
   *
   * 영상은 사건 순간을 잘라 캡처를 만들지만 이미지 시퀀스는 그러지 않는다 — 근거가 될
   * 그림이 이미 입력 프레임 그 자체라 서비스가 새로 만들 이유가 없다. 그런데 그대로 두면
   * evidencePath 가 빈 사건이 남고, 사건 목록에는 "근거 이미지가 없습니다" 만 뜬다.
   * 근거가 없는 게 아니라 가리키지 않았을 뿐이라 그 사건의 프레임으로 되돌아간다.
   */
  const posterFallback = analysis.posterPath ?? "";
  const inputFrames: string[] = (() => {
    try {
      const parsed = JSON.parse(analysis.frameUrls || "[]");
      return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
    } catch {
      return [];
    }
  })();

  function evidenceOf(event: (typeof events)[number], frameIndex?: number) {
    const capture = event.captures.find((c) => c.kind === "frame")?.url;
    if (capture) return capture;
    if (frameIndex != null && inputFrames[frameIndex]) return inputFrames[frameIndex];
    return inputFrames[0] ?? posterFallback;
  }

  const written = await prisma.$transaction([
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
      const prior = event.startedAt
        ? priorByKey.get(`${zone?.id ?? null}|${event.code}|${enteredAt.toISOString()}`)
        : undefined;

      if (prior) {
        // 이미 있는 사건이면 근거만 새로 고친다. 사람의 판단(status·notifiedAt·review)은
        // 건드리지 않는다 — 재분석은 판단을 되돌리는 행위가 아니다.
        //
        // 확정된 건의 근거 이미지는 Blob 으로 옮겨져 영구 보관 중이다. 휘발성 AI 캡처
        // 주소로 덮으면 근거가 사라진다.
        const keepEvidence = prior.status === "CONFIRMED";
        return prisma.riskEvent.update({
          where: { id: prior.id },
          data: {
            analysisId: analysis.id,
            level: event.level,
            reason: event.reason,
            dwellSec: event.dwellSec,
            occupantsAtPeak: event.occupantsAtPeak,
            trackIds: JSON.stringify(event.trackIds),
            clipStartSec: event.startSec,
            clipEndSec: event.endSec,
            peakSec: event.peakSec,
            machineState: event.machineState,
            confidence: frame?.persons[0]?.confidence ?? prior.confidence,
            boxes: JSON.stringify(frame?.persons ?? []),
            modelRepo: result.model,
            ...harnessGuessOf(frame, zone?.id),
            ...(keepEvidence
              ? {}
              : {
                  evidencePath: evidenceOf(event, frame?.index),
                  clipPath: event.captures.find((c) => c.kind === "clip")?.url ?? "",
                }),
          },
        });
      }

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
          evidencePath: evidenceOf(event, frame?.index),
          clipPath: event.captures.find((c) => c.kind === "clip")?.url ?? "",
          boxes: JSON.stringify(frame?.persons ?? []),
          zonePolygon: zone?.polygon ?? "[]",
          interlockEngaged: event.level === "CRITICAL",
          // AI 가 말할 수 있는 건 착용까지다. 이건 제안이고 확정이 아니다.
          ...harnessGuessOf(frame, zone?.id),
          // 체결 확정은 사람 몫이다. 필요한 구역이면 사람이 채울 칸을 열어 둔다.
          harnessStatus: zone?.requiresHarness ? "PENDING" : "NA",
          // 정상 작업 기록은 판정 큐에 올리지 않는다.
          status: event.level === "INFO" ? "LOGGED" : "PENDING",
          notifiedAt: now,
          modelRepo: result.model,
        },
      });
    }),
  ]);

  await recordStoppageEpisodes({
    analysis,
    durationSec: result.videoDurationSec,
    aiEvents: result.events.map((e) => ({ startedAt: e.startedAt ?? null, startSec: e.startSec })),
    // 트랜잭션 결과의 첫 칸은 VideoAnalysis 갱신이고, 그 뒤가 생성된 위험 사건들이다.
    created: written.slice(1) as CreatedRiskEvent[],
    base: now,
  });

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

/**
 * 피크 프레임에서 이 구역 사람들의 하네스 착용 추정을 하나로 모은다.
 *
 * 미착용 의심이 하나라도 있으면 그게 결론이다 — 세 명 중 한 명이 안 입었으면
 * "한 명이 안 입었다" 가 관리자가 알아야 하는 사실이다.
 *
 * 모델이 없으면 빈 문자열로 남긴다. UNKNOWN 으로 채우면 "모델이 봤는데 모르겠다" 가
 * 되어 화면 문구가 거짓이 된다.
 */
function harnessGuessOf(
  frame: { persons: TrackBox[] } | undefined,
  zoneId: string | undefined,
): { harnessAiStatus: string; harnessAiConfidence: number } {
  const persons = frame?.persons ?? [];
  const inZone = zoneId ? persons.filter((p) => p.zoneIds.includes(zoneId)) : persons;
  const guesses = (inZone.length > 0 ? inZone : persons)
    .map((p) => p.harness)
    .filter((g): g is NonNullable<typeof g> => g != null);

  if (guesses.length === 0) return { harnessAiStatus: "", harnessAiConfidence: 0 };

  const missing = guesses.filter((g) => g.status === "NOT_WORN");
  if (missing.length > 0) {
    return {
      harnessAiStatus: "NOT_WORN",
      harnessAiConfidence: Math.max(...missing.map((g) => g.confidence)),
    };
  }
  const worn = guesses.filter((g) => g.status === "WORN");
  if (worn.length > 0) {
    return {
      harnessAiStatus: "WORN",
      harnessAiConfidence: Math.max(...worn.map((g) => g.confidence)),
    };
  }
  return { harnessAiStatus: "UNKNOWN", harnessAiConfidence: 0 };
}

type CreatedRiskEvent = {
  id: string;
  dwellSec: number;
  clipStartSec: number | null;
  clipEndSec: number | null;
};

/**
 * 정지 에피소드를 남긴다.
 *
 * 이 함수가 이 시스템의 "사업성" 쪽 절반이다. 인터록은 지금 이 사고를 막고, 에피소드는
 * 같은 상황이 몇 번 반복되는지와 그때마다 라인이 몇 분 섰는지를 남긴다. 후자가 없으면
 * 사업주에게 보여줄 숫자가 없다.
 */
async function recordStoppageEpisodes(input: {
  analysis: { id: string; workplaceId: string; equipmentId: string; machineStates: string };
  durationSec: number;
  aiEvents: { startedAt: string | null; startSec: number }[];
  created: CreatedRiskEvent[];
  base: Date;
}) {
  const { analysis, durationSec, aiEvents, created, base } = input;

  let states: MachineStatePoint[] = [];
  try {
    const parsed = JSON.parse(analysis.machineStates);
    if (Array.isArray(parsed)) states = parsed as MachineStatePoint[];
  } catch {
    return; // 상태 타임라인이 깨졌으면 에피소드를 만들지 않는다. 추측해서 채우면 지표가 거짓이 된다.
  }

  const intervals = stoppageIntervals(states, durationSec);
  if (intervals.length === 0) return;

  const recordedFrom = recordingBase(aiEvents, base);

  for (const interval of intervals) {
    const inside = created.filter(
      (e) =>
        e.clipStartSec != null &&
        e.clipEndSec != null &&
        overlapsInterval(interval, e.clipStartSec, e.clipEndSec, durationSec),
    );

    const episode = await prisma.stoppageEpisode.create({
      data: {
        workplaceId: analysis.workplaceId,
        equipmentId: analysis.equipmentId,
        analysisId: analysis.id,
        // 원인을 AI 가 아는 척하지 않는다. 위험접근이 동반된 정지만 걸림 대응으로 "추정"하고,
        // 관리자가 화면에서 계획 정비로 되돌릴 수 있게 둔다.
        cause: inside.length > 0 ? "JAM" : "OTHER",
        source: "AI",
        startedAt: atSec(recordedFrom, interval.startSec),
        restartedAt: interval.restartSec == null ? null : atSec(recordedFrom, interval.restartSec),
        recoverySec: interval.restartSec == null ? 0 : interval.restartSec - interval.startSec,
        riskApproach: inside.length > 0,
        approachCount: inside.length,
        approachDwellSec: inside.reduce((sum, e) => sum + e.dwellSec, 0),
      },
    });

    if (inside.length > 0) {
      await prisma.riskEvent.updateMany({
        where: { id: { in: inside.map((e) => e.id) } },
        data: { episodeId: episode.id },
      });
    }
  }
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
