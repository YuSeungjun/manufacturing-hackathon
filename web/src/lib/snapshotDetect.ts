import "server-only";
import { analyzeFrameZones, AiServiceError, type ZoneSpec } from "@/lib/aiClient";

/**
 * 수신 시점 1차 탐지.
 *
 * 카메라가 "위험구역에 접근했다" 고 말했으면 그 근거가 함께 있어야 한다. 수신할 때
 * 프레임 한 장을 판정해 사람 박스를 붙여 두고, 수신함 썸네일이 그걸 그린다.
 *
 * **1차 탐지는 판정이 아니다.** 잔류도, 설비 상태 결합도, 사건 생성도 하지 않는다 —
 * 그건 여러 장을 묶는 시퀀스 분석의 몫이다. 여기서 하는 건 "이 한 장에 사람이 어디
 * 있었나" 뿐이다.
 *
 * 실패해도 수신은 성공해야 한다. AI 서비스가 재시작 중이라고 카메라가 밀어 넣는 장면을
 * 잃어버리면, 정작 필요한 순간의 근거가 사라진다. 그래서 실패는 조용히 빈 결과가 되고
 * `detectedAt` 이 비어 남는다 — "탐지하지 않았다" 와 "탐지했는데 사람이 없었다" 를
 * 구분할 수 있어야 한다.
 */

export type SnapshotDetection = {
  personCount: number;
  boxes: string;
  zoneOccupancy: string;
  riskLevel: string;
  modelRepo: string;
  detectedAt: Date | null;
};

const EMPTY: SnapshotDetection = {
  personCount: 0,
  boxes: "[]",
  zoneOccupancy: "{}",
  riskLevel: "SAFE",
  modelRepo: "",
  detectedAt: null,
};

/** 이미 올라간 이미지를 다시 받아 온다. AI 서비스는 multipart 로만 프레임을 받는다. */
async function fetchAsFile(url: string): Promise<File | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], "frame.jpg", { type: blob.type || "image/jpeg" });
  } catch {
    return null;
  }
}

export async function detectSnapshot(
  source: File | string,
  zones: ZoneSpec[],
): Promise<SnapshotDetection> {
  if (zones.length === 0) return EMPTY;

  const file = typeof source === "string" ? await fetchAsFile(source) : source;
  if (!file || file.size === 0) return EMPTY;

  try {
    // 설비 상태는 STOPPED 로 둔다. 1차 탐지는 위험도를 정하는 자리가 아니라 위치를 보는
    // 자리이고, 여기서 RESTART_REQUESTED 를 넣으면 근거 없이 CRITICAL 이 찍힌다.
    const result = await analyzeFrameZones(file, zones, "STOPPED");
    return {
      personCount: result.personCount,
      boxes: JSON.stringify(result.persons),
      zoneOccupancy: JSON.stringify(result.occupancy),
      riskLevel: result.riskLevel,
      modelRepo: result.model,
      detectedAt: new Date(),
    };
  } catch (error) {
    if (!(error instanceof AiServiceError)) throw error;
    return EMPTY;
  }
}

/** 구역 안에 한 명이라도 있었나. 수신함에서 "접근" 배지를 띄우는 조건이다. */
export function occupiedCount(zoneOccupancy: string): number {
  try {
    const parsed = JSON.parse(zoneOccupancy) as Record<string, number>;
    return Object.values(parsed).reduce((sum, value) => sum + (Number(value) || 0), 0);
  } catch {
    return 0;
  }
}
