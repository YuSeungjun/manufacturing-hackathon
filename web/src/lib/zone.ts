/** 위험구역·위험사건의 공통 정의. 구 ppe.ts 자리를 대체한다. */

export type ZonePoint = [number, number];

/** AI 가 돌려주는 사람 박스. 좌표는 전부 0~1 정규화. */
export type TrackBox = {
  trackId: number | null;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
  zoneIds: string[];
  occupancy: Record<string, number>;
  /** 발끝을 믿을 수 없는 박스 — 화면 밖으로 잘렸거나 하반신이 가려졌다 */
  truncated: boolean;
};

export type TimelineFrame = {
  index: number;
  tSec: number;
  persons: TrackBox[];
  /** track id 에 의존하지 않는 인원수. 위험 판정의 근거는 이것 하나다. */
  zoneOccupancy: Record<string, number>;
  zoneDwell: Record<string, number>;
  machineState: Record<string, string>;
  riskLevel: RiskLevel;
};

export type RiskLevel = "SAFE" | "INFO" | "CAUTION" | "WARNING" | "CRITICAL";

export const LEVEL_ORDER: Record<RiskLevel, number> = {
  SAFE: 0,
  INFO: 1,
  CAUTION: 2,
  WARNING: 3,
  CRITICAL: 4,
};

export const LEVEL_LABEL: Record<string, string> = {
  SAFE: "정상",
  INFO: "기록",
  CAUTION: "주의",
  WARNING: "경고",
  CRITICAL: "위험",
};

/** 색만으로 뜻을 전하지 않기 위해 기호를 함께 쓴다. */
export const LEVEL_MARK: Record<string, string> = {
  SAFE: "·",
  INFO: "ℹ",
  CAUTION: "△",
  WARNING: "▲",
  CRITICAL: "■",
};

export const RISK_CODE_LABEL: Record<string, string> = {
  ZONE_INTRUSION: "위험구역 진입",
  PROLONGED_DWELL: "위험구역 잔류",
  LOTO_MISSING: "시건 없이 작업",
  ENTRY_WHILE_RUNNING: "가동 중 위험구역 진입",
  RESTART_WITH_WORKER_INSIDE: "작업자 잔류 중 재가동",
  MANUAL: "관리자 직접 등록",
};

export const RISK_STATUS_LABEL: Record<string, string> = {
  PENDING: "검토 대기",
  CONFIRMED: "위험 확정",
  FALSE_POSITIVE: "오탐",
  HOLD: "판단 보류",
};

export const RUN_STATE_LABEL: Record<string, string> = {
  RUNNING: "가동",
  STOPPED: "정지",
  MAINTENANCE: "정비 중",
};

export const MACHINE_STATE_LABEL: Record<string, string> = {
  STOPPED: "정지",
  LOTO: "시건 완료",
  RESTART_REQUESTED: "재가동 요청",
  RUNNING: "가동",
};

export const INTERLOCK_LABEL: Record<string, string> = {
  CLEAR: "재가동 가능",
  BLOCKED: "재가동 차단",
};

export const ZONE_KIND_LABEL: Record<string, string> = {
  PINCH: "끼임",
  ROTATING: "회전체",
  TRAVEL: "이송",
  GENERAL: "일반",
};

export const SEVERITY_LABEL: Record<string, string> = {
  HIGH: "높음",
  MEDIUM: "보통",
  LOW: "낮음",
};

export function riskCodeLabel(code: string) {
  return RISK_CODE_LABEL[code] ?? code;
}

export function levelLabel(level: string) {
  return LEVEL_LABEL[level] ?? level;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function parsePolygon(raw: string | null | undefined): ZonePoint[] {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
    .map(([x, y]) => [Number(x), Number(y)] as ZonePoint)
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

export function parseBoxes(raw: string | null | undefined): TrackBox[] {
  const parsed = parseJson<unknown>(raw, []);
  return Array.isArray(parsed) ? (parsed as TrackBox[]) : [];
}

export function parseTimeline(raw: string | null | undefined): TimelineFrame[] {
  const parsed = parseJson<unknown>(raw, []);
  return Array.isArray(parsed) ? (parsed as TimelineFrame[]) : [];
}

export function parseTrackIds(raw: string | null | undefined): number[] {
  const parsed = parseJson<unknown>(raw, []);
  return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
}

/** SVG polygon 의 points 속성. viewBox="0 0 1 1" 위에 그린다. */
export function polygonPoints(polygon: ZonePoint[]): string {
  return polygon.map(([x, y]) => `${x},${y}`).join(" ");
}

/** 위험 수준에 대응하는 CSS 변수. 색만으로 뜻을 전하지 않으니 기호와 함께 쓴다. */
export function levelTone(level: string) {
  if (level === "CRITICAL") return "var(--deny)";
  if (level === "WARNING") return "var(--hold)";
  if (level === "CAUTION") return "var(--act)";
  return "var(--ink-3)";
}

export const ROLE_LABEL: Record<string, string> = {
  WORKER: "정비 작업자",
  OPERATOR: "설비 운전 담당자",
  SAFETY_MANAGER: "안전관리자",
};
