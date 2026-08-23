import "server-only";
import type { RiskLevel, TimelineFrame, TrackBox, ZonePoint } from "@/lib/zone";

/**
 * 위험구역 감시 서비스 클라이언트.
 *
 * 영상 분석은 잡+폴링이다. HF Space 게이트웨이(~60초)와 Vercel 함수 타임아웃을
 * 한꺼번에 우회하고, 덤으로 진행률 바가 생긴다.
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000";

/** 탐지 서비스가 공개 주소에 있을 때만 토큰을 쓴다. 로컬은 설정 없이 그대로 붙는다. */
function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = process.env.AI_SERVICE_TOKEN;
  return { ...(extra ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export class AiServiceError extends Error {}

export type ZoneSpec = {
  id: string;
  name: string;
  polygon: ZonePoint[];
  kind?: string;
  dwellWarnSec?: number;
};

export type MachineStatePoint = {
  tSec: number;
  state: "STOPPED" | "LOTO" | "RESTART_REQUESTED" | "RUNNING";
  zoneIds?: string[];
};

export type AiCapture = {
  captureId: string;
  kind: "frame" | "clip";
  mimeType: string;
  url: string | null;
  dataBase64?: string | null;
  tSec: number;
  width: number;
  height: number;
  frameCount: number;
};

export type AiRiskEvent = {
  eventId: string;
  code: string;
  level: RiskLevel;
  zoneId: string;
  zoneName: string;
  trackIds: number[];
  startSec: number;
  endSec: number;
  peakSec: number;
  dwellSec: number;
  machineState: string;
  occupantsAtPeak: number;
  reason: string;
  captures: AiCapture[];
  startedAt: string | null;
};

export type AiZoneStat = {
  zoneId: string;
  zoneName: string;
  totalDwellSec: number;
  entryCount: number;
  uniqueTrackCount: number;
  occupiedRatio: number;
  eventCounts: Record<string, number>;
  maxLevel: RiskLevel;
};

export type AnalyzeResult = {
  jobId: string;
  model: string;
  videoDurationSec: number;
  sourceFps: number;
  sampledFps: number;
  frameCount: number;
  processingSec: number;
  frames: TimelineFrame[];
  events: AiRiskEvent[];
  zoneStats: AiZoneStat[];
  timeBuckets: { startSec: number; endSec: number; maxLevel: RiskLevel; occupiedFrames: number; eventCount: number }[];
  warnings: string[];
};

export type AiJobStatus = {
  jobId: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
  progress: number;
  processedFrames: number;
  totalFrames: number;
  etaSec: number | null;
  result: AnalyzeResult | null;
  error: string | null;
};

export type FrameCheckResult = {
  model: string;
  imageWidth: number;
  imageHeight: number;
  personCount: number;
  occupancy: Record<string, number>;
  persons: TrackBox[];
  riskLevel: RiskLevel;
};

async function call<T>(path: string, init: RequestInit, what: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${AI_SERVICE_URL}${path}`, { ...init, cache: "no-store" });
  } catch {
    throw new AiServiceError(`${what} 중 AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.`);
  }
  if (!response.ok) {
    // 서비스가 사람이 읽을 수 있는 detail 을 준다. 그대로 올린다.
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: string };
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      /* 본문이 JSON 이 아닐 수 있다 */
    }
    throw new AiServiceError(detail || `${what} 실패 (HTTP ${response.status})`);
  }
  return (await response.json()) as T;
}

/** 영상 분석 잡을 띄운다. 영상 자체는 Blob 에 있고 여기에는 URL 만 넘어간다. */
export async function startVideoAnalysis(input: {
  videoUrl: string;
  zones: ZoneSpec[];
  machineStates: MachineStatePoint[];
  recordedAt?: Date;
}): Promise<{ jobId: string }> {
  return call<{ jobId: string }>(
    "/analyze/video",
    {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        videoUrl: input.videoUrl,
        zones: input.zones.map((z) => ({
          id: z.id,
          name: z.name,
          polygon: z.polygon,
          kind: z.kind ?? "PINCH",
          dwellWarnSec: z.dwellWarnSec ?? 5,
        })),
        machineStates: input.machineStates,
        options: {
          captureMode: "url",
          clipFormat: "webp",
          blurFaces: true,
          recordedAt: (input.recordedAt ?? new Date()).toISOString(),
        },
      }),
    },
    "영상 분석 요청",
  );
}

/**
 * 정지 이미지 시퀀스 분석 잡을 띄운다.
 *
 * 이미지도 영상과 같은 이유로 Blob 을 거친다 — 몇 장만 모이면 Vercel Function 요청 본문
 * 4.5MB 를 넘는다. 여기에는 URL 목록과 각 장의 초만 넘어간다.
 *
 * 결과 계약(AnalyzeResult)이 영상과 같아서 폴링 화면과 저장 코드를 그대로 쓴다.
 */
export async function startFrameAnalysis(input: {
  frameUrls: string[];
  frameTimes: number[];
  zones: ZoneSpec[];
  machineStates: MachineStatePoint[];
  recordedAt?: Date;
}): Promise<{ jobId: string; frameCount: number }> {
  const body = new FormData();
  body.append(
    "body",
    JSON.stringify({
      frameUrls: input.frameUrls,
      frameTimes: input.frameTimes,
      zones: input.zones.map((z) => ({
        id: z.id,
        name: z.name,
        polygon: z.polygon,
        kind: z.kind ?? "PINCH",
        dwellWarnSec: z.dwellWarnSec ?? 5,
      })),
      machineStates: input.machineStates,
      options: {
        captureMode: "url",
        // 정지 이미지에는 이어붙일 앞뒤 프레임이 없다. 클립을 만들지 않는다.
        clipFormat: "none",
        blurFaces: true,
        recordedAt: (input.recordedAt ?? new Date()).toISOString(),
      },
    }),
  );

  return call<{ jobId: string; frameCount: number }>(
    "/analyze/frames",
    { method: "POST", headers: authHeaders(), body },
    "이미지 분석 요청",
  );
}

export type HarnessCheckResult = {
  /** none | roboflow | local — 남의 학습 결과면 화면에 그렇게 적는다 */
  provider: string;
  model: string;
  personCount: number;
  persons: {
    confidence: number;
    x: number;
    y: number;
    w: number;
    h: number;
    harness: {
      status: "WORN" | "NOT_WORN" | "UNKNOWN";
      confidence: number;
      hookStatus: "ATTACHED" | "NOT_ATTACHED" | "UNKNOWN";
      hookConfidence: number;
      cropPx: number;
    };
  }[];
  verdict: "WORN" | "NOT_WORN" | "UNKNOWN";
  confidence: number;
  hookVerdict: "ATTACHED" | "NOT_ATTACHED" | "UNKNOWN";
  hookConfidence: number;
  error: string;
};

/**
 * 안전대 착용·체결 판정 — 이미지 한 장.
 *
 * 위험구역 분석과 갈라 둔 호출이다. 진입·잔류는 우리 로직이지만 안전대는 별도 모델에
 * 의존하므로, 한쪽이 죽는 날 다른 쪽 결과까지 못 믿게 되면 안 된다.
 */
export async function analyzeHarness(file: File, conf = 0.3): Promise<HarnessCheckResult> {
  const body = new FormData();
  body.append("file", file, file.name || "frame.jpg");
  body.append("conf", String(conf));
  return call<HarnessCheckResult>(
    "/analyze/harness",
    { method: "POST", headers: authHeaders(), body },
    "안전대 판정",
  );
}

export async function getJob(jobId: string): Promise<AiJobStatus> {
  return call<AiJobStatus>(`/analyze/jobs/${jobId}`, { headers: authHeaders() }, "분석 진행 상황 조회");
}

/** 단일 프레임 즉석 점유 판정. 재가동 요청 화면에서 "지금 비었나"를 확인할 때 쓴다. */
export async function analyzeFrameZones(
  file: File,
  zones: ZoneSpec[],
  machineState = "STOPPED",
): Promise<FrameCheckResult> {
  const body = new FormData();
  body.append("file", file, file.name || "frame.jpg");
  body.append("zones", JSON.stringify(zones));
  body.append("machineState", machineState);
  return call<FrameCheckResult>(
    "/analyze/frame",
    { method: "POST", body, headers: authHeaders() },
    "프레임 판정",
  );
}

/** 캡처 바이트를 가져온다. 사람이 위험으로 확정한 건만 Blob 에 영구 보관한다. */
export async function fetchCapture(url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const response = await fetch(`${AI_SERVICE_URL}${url}`, { headers: authHeaders(), cache: "no-store" });
    if (!response.ok) return null;
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}

export type AiHealth = {
  status: string;
  model: string;
  modelRepo: string;
  classes: string[];
  imgsz: number;
  targetFps: number;
  maxDurationSec: number;
  activeJobs: number;
  identifiesIndividuals: boolean;
  faceBlur: boolean;
};

export async function aiHealth(): Promise<AiHealth | null> {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/health`, { cache: "no-store", headers: authHeaders() });
    if (!response.ok) return null;
    return (await response.json()) as AiHealth;
  } catch {
    return null;
  }
}

export function aiServiceUrl() {
  return AI_SERVICE_URL;
}
