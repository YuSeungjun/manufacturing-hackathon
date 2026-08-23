/** AI 모델이 탐지하는 위반 코드와 TBM 안전수칙을 잇는 공통 정의. */

export const PPE_CODES = {
  NO_HARDHAT: {
    label: "안전모 미착용",
    rule: "안전모 착용",
    defaultSeverity: "HIGH",
    defaultPenalty: 20,
  },
  NO_SAFETY_VEST: {
    label: "안전조끼 미착용",
    rule: "안전조끼 착용",
    defaultSeverity: "MEDIUM",
    defaultPenalty: 10,
  },
  NO_MASK: {
    label: "방진마스크 미착용",
    rule: "방진마스크 착용",
    defaultSeverity: "MEDIUM",
    defaultPenalty: 10,
  },
} as const;

export type PpeCode = keyof typeof PPE_CODES;

export const PPE_CODE_LIST = Object.keys(PPE_CODES) as PpeCode[];

export function ppeLabel(code: string) {
  return PPE_CODES[code as PpeCode]?.label ?? code;
}

export const SEVERITY_LABEL: Record<string, string> = {
  HIGH: "높음",
  MEDIUM: "보통",
  LOW: "낮음",
};

export const DETECTION_TYPE_LABEL: Record<string, string> = {
  CCTV: "CCTV 영상 분석",
  SENSOR: "센서",
  MANUAL: "육안 점검",
};

export const DETECTION_STATUS_LABEL: Record<string, string> = {
  PENDING: "검토 대기",
  CONFIRMED: "위반 확정",
  FALSE_POSITIVE: "오탐",
  HOLD: "판단 보류",
};

/** 탐지 박스(정규화 좌표). AI 서비스 응답과 동일한 형태. */
export type DetectionBox = {
  label: string;
  code: string;
  kind: "violation" | "compliance" | "context";
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export function parseBoxes(raw: string): DetectionBox[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DetectionBox[]) : [];
  } catch {
    return [];
  }
}
