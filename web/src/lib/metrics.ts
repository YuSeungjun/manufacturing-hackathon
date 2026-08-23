import { prisma } from "@/lib/prisma";
import { SITE_ZONE } from "@/lib/date";

/**
 * 도입 효과를 사고 건수로 주장하지 않는다. 실제로 잰 시간과 횟수로 증명한다.
 *
 * 여섯 지표 전부 이 파일 하나에서 나온다 — 화면마다 다르게 계산하면
 * 같은 숫자가 두 값으로 보이기 시작한다.
 */

export type SafetyMetrics = {
  detectLatency: { avgSec: number | null; p95Sec: number | null; n: number };
  response: {
    ackSec: number | null;
    judgeSec: number | null;
    clearSec: number | null;
    n: number;
  };
  exposure: {
    totalSec: number;
    byZone: { zoneId: string; name: string; sec: number; events: number }[];
    byHour: number[];
  };
  blocked: { requests: number; autoInterlocks: number; confirmed: number };
  reviewLoad: { footageSec: number; watchedSec: number; savedRatio: number | null };
  accuracy: {
    falsePositiveRate: number | null;
    missRate: number | null;
    confirmed: number;
    falsePositive: number;
    missed: number;
    undecided: number;
  };
};

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_ZONE,
  hour: "2-digit",
  hour12: false,
});

/** 현장 시간대 기준 시(hour). 서버가 UTC 라도 밤 근무가 새벽으로 밀리지 않는다. */
function siteHour(date: Date): number {
  return Number(hourFormatter.format(date)) % 24;
}

export async function safetyMetrics(
  workplaceId: string,
  from: Date,
  to: Date,
): Promise<SafetyMetrics> {
  const window = { gte: from, lt: to };
  const [events, restarts, analyses] = await Promise.all([
    prisma.riskEvent.findMany({
      where: { workplaceId, detectedAt: window },
      include: { zone: true, review: true },
    }),
    prisma.restartRequest.findMany({ where: { workplaceId, requestedAt: window } }),
    prisma.videoAnalysis.findMany({
      where: { workplaceId, analyzedAt: window },
      select: { durationSec: true },
    }),
  ]);

  // ① 위험 감지 소요시간 — 구역에 들어선 순간부터 AI 가 위험이라고 말할 때까지
  const aiEvents = events.filter((e) => e.source === "AI");
  const latencies = aiEvents
    .map((e) => (e.detectedAt.getTime() - e.enteredAt.getTime()) / 1000)
    .filter((v) => v >= 0 && Number.isFinite(v));

  // ② 관리자 조치 소요시간 — 인지 / 판단 / 해제 세 단계로 나눠 본다
  const ackDeltas: number[] = [];
  const judgeDeltas: number[] = [];
  for (const event of events) {
    if (!event.notifiedAt) continue;
    if (event.acknowledgedAt) {
      ackDeltas.push((event.acknowledgedAt.getTime() - event.notifiedAt.getTime()) / 1000);
    }
    if (event.review) {
      judgeDeltas.push((event.review.reviewedAt.getTime() - event.notifiedAt.getTime()) / 1000);
    }
  }
  const clearDeltas = restarts
    .filter((r) => r.decision === "BLOCKED" && r.approvedAt)
    .map((r) => (r.approvedAt!.getTime() - r.requestedAt.getTime()) / 1000);

  // ③ 위험구역 노출시간 — 구역별·시간대별로 쪼개야 "반복되는 위험 시간대"가 보인다
  const byZone = new Map<string, { zoneId: string; name: string; sec: number; events: number }>();
  const byHour = Array<number>(24).fill(0);
  let totalSec = 0;
  for (const event of events) {
    const seconds = event.clearedAt
      ? Math.max(0, (event.clearedAt.getTime() - event.enteredAt.getTime()) / 1000)
      : event.dwellSec;
    totalSec += seconds;
    byHour[siteHour(event.enteredAt)] += seconds;

    const key = event.zoneId ?? "unzoned";
    const entry = byZone.get(key) ?? {
      zoneId: key,
      name: event.zone?.name ?? "구역 미지정",
      sec: 0,
      events: 0,
    };
    entry.sec += seconds;
    entry.events += 1;
    byZone.set(key, entry);
  }

  // ④ 차단한 위험 재가동 — 후보 수와 "사람이 실제 위험으로 확정한 수"를 나눠 적는다
  const blockedRequests = restarts.filter((r) => r.decision === "BLOCKED").length;
  const autoInterlocks = events.filter((e) => e.interlockEngaged).length;
  const blockedConfirmed = events.filter(
    (e) => e.interlockEngaged && e.status === "CONFIRMED",
  ).length;

  // ⑤ CCTV 확인 업무시간 — 다 봐야 했을 시간 vs 실제로 본 구간
  const footageSec = analyses.reduce((sum, a) => sum + a.durationSec, 0);
  const watchedSec = events.reduce((sum, e) => {
    if (e.clipStartSec == null || e.clipEndSec == null) return sum;
    return sum + Math.max(0, e.clipEndSec - e.clipStartSec);
  }, 0);

  // ⑥ 오탐 / 미탐 — 미판단(PENDING·HOLD)은 분모에서 뺀다. 정확도의 근거가 못 된다.
  const confirmed = events.filter((e) => e.source === "AI" && e.status === "CONFIRMED").length;
  const falsePositive = events.filter((e) => e.status === "FALSE_POSITIVE").length;
  const missed = events.filter((e) => e.source === "MANUAL").length;
  const undecided = events.filter((e) => e.status === "PENDING" || e.status === "HOLD").length;
  const judged = confirmed + falsePositive;

  return {
    detectLatency: {
      avgSec: avg(latencies),
      p95Sec: percentile(latencies, 95),
      n: latencies.length,
    },
    response: {
      ackSec: avg(ackDeltas),
      judgeSec: avg(judgeDeltas),
      clearSec: avg(clearDeltas),
      n: Math.max(ackDeltas.length, judgeDeltas.length, clearDeltas.length),
    },
    exposure: {
      totalSec,
      byZone: [...byZone.values()].sort((a, b) => b.sec - a.sec),
      byHour,
    },
    blocked: { requests: blockedRequests, autoInterlocks, confirmed: blockedConfirmed },
    reviewLoad: {
      footageSec,
      watchedSec,
      savedRatio: footageSec > 0 ? Math.max(0, 1 - watchedSec / footageSec) : null,
    },
    accuracy: {
      falsePositiveRate: judged > 0 ? falsePositive / judged : null,
      missRate: missed + confirmed > 0 ? missed / (missed + confirmed) : null,
      confirmed,
      falsePositive,
      missed,
      undecided,
    },
  };
}

/** 노출시간 등급 — 구 scoreBand 자리. 점수가 아니라 시간을 본다. */
export function exposureBand(seconds: number): "ok" | "warn" | "risk" {
  if (seconds <= 0) return "ok";
  if (seconds < 30) return "warn";
  return "risk";
}

export function exposureTone(seconds: number) {
  const band = exposureBand(seconds);
  if (band === "ok") return "var(--safe)";
  if (band === "warn") return "var(--hold)";
  return "var(--deny)";
}
