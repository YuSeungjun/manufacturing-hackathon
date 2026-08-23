/**
 * 정지 에피소드 — "설비가 멈춘 한 사이클" 을 설비 상태 타임라인에서 뽑아낸다.
 *
 * AI 는 "제품이 걸렸다" 를 보지 못한다. 볼 수 있는 것은 두 개다.
 *   ① 설비가 멈춰 있다      (PLC / LOTO / 화면 입력이 주는 상태 타임라인)
 *   ② 사람이 위험구역에 있다 (영상 분석이 주는 위험 사건)
 *
 * 이 파일은 ①에서 구간을 자르고 ②를 그 구간에 붙인다. 그래서 나오는 문장이
 * "걸림을 감지했다" 가 아니라 "정지 구간 안에서 위험구역 접근이 있었다" 다.
 * 후자는 실제로 잰 것이고 전자는 아니다.
 *
 * prisma 를 import 하지 않는다 — 순수 함수로 두어야 테스트가 된다.
 */

import type { MachineStatePoint } from "@/lib/aiClient";

/** 재가동 완료(RUNNING) 전까지는 전부 "멈춰 있는" 상태다. 재가동 요청도 아직 안 돌아간 것이다. */
const STOPPED_STATES = new Set(["STOPPED", "LOTO", "RESTART_REQUESTED"]);

export type StoppageInterval = {
  /** 영상 기준 정지 시작 초 */
  startSec: number;
  /** 재가동(RUNNING) 시각. 영상이 끝날 때까지 안 돌면 null — 아직 진행 중이다. */
  restartSec: number | null;
};

/**
 * 상태 타임라인 → 정지 구간들.
 *
 * 상태 점은 "이 시각부터 이 상태" 라는 계단 함수다. 구간 사이를 보간하지 않는다.
 */
export function stoppageIntervals(
  states: MachineStatePoint[],
  durationSec: number,
): StoppageInterval[] {
  if (states.length === 0) return [];

  const points = [...states].sort((a, b) => a.tSec - b.tSec);
  const intervals: StoppageInterval[] = [];
  let open: StoppageInterval | null = null;

  for (const point of points) {
    const stopped = STOPPED_STATES.has(point.state);
    if (stopped && !open) {
      open = { startSec: Math.max(0, point.tSec), restartSec: null };
    } else if (!stopped && open) {
      open.restartSec = point.tSec;
      intervals.push(open);
      open = null;
    }
  }
  // 영상이 끝날 때까지 재가동이 없으면 열린 채로 남긴다. 0 으로 닫으면 복구시간이 거짓이 된다.
  if (open) intervals.push(open);

  return intervals.filter((i) => i.startSec <= Math.max(durationSec, 0));
}

/** 이 구간 안에서 벌어진 일인가. 사건 구간과 정지 구간이 겹치면 그렇다고 본다. */
export function overlapsInterval(
  interval: StoppageInterval,
  eventStartSec: number,
  eventEndSec: number,
  durationSec: number,
): boolean {
  const end = interval.restartSec ?? Math.max(durationSec, eventEndSec);
  return eventStartSec <= end && eventEndSec >= interval.startSec;
}

/**
 * 영상 내 초 → 절대 시각.
 *
 * AI 가 `recordedAt` 을 받았으면 사건에 `startedAt` 이 실려 온다. 그걸로 촬영 시작 시각을
 * 되계산한다. 없으면 분석 시각을 기준으로 둔다 — 데모에서는 그게 유일한 단서다.
 */
export function recordingBase(
  events: { startedAt: string | null; startSec: number }[],
  fallback: Date,
): Date {
  for (const event of events) {
    if (!event.startedAt) continue;
    const at = new Date(event.startedAt);
    if (Number.isFinite(at.getTime())) {
      return new Date(at.getTime() - event.startSec * 1000);
    }
  }
  return fallback;
}

export function atSec(base: Date, sec: number): Date {
  return new Date(base.getTime() + sec * 1000);
}

export const EPISODE_CAUSE_LABEL: Record<string, string> = {
  JAM: "제품 걸림",
  MAINTENANCE: "계획 정비",
  OTHER: "기타",
};

export const EPISODE_SOURCE_LABEL: Record<string, string> = {
  AI: "영상 분석",
  PLC: "설비 신호",
  MANUAL: "수동 입력",
};
