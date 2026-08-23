import { prisma } from "@/lib/prisma";

export const BASE_SCORE = 100;

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfToday() {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

/**
 * 안전이행 점수.
 * AI 탐지만으로는 감점하지 않는다. 안전관리자가 위반으로 확정한 건만 반영한다.
 */
export async function teamScore(teamId: string, from: Date, to: Date) {
  const confirmed = await prisma.detection.findMany({
    where: {
      status: "CONFIRMED",
      detectedAt: { gte: from, lt: to },
      tbm: { teamId },
    },
    include: { safetyRule: true },
  });

  const penalty = confirmed.reduce((sum, d) => sum + (d.safetyRule?.penalty ?? 10), 0);
  return {
    score: Math.max(0, BASE_SCORE - penalty),
    confirmedCount: confirmed.length,
    penalty,
  };
}

export function scoreTone(score: number) {
  if (score >= 90) return "var(--safe)";
  if (score >= 70) return "var(--hold)";
  return "var(--deny)";
}

/** 점수 구간 — 반사 테이프 엣지의 색을 정한다. */
export function scoreBand(score: number): "ok" | "warn" | "risk" {
  if (score >= 90) return "ok";
  if (score >= 70) return "warn";
  return "risk";
}
