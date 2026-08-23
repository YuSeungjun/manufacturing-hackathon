export const BASE_SCORE = 100;
export const CONFIRMED_EVENT_PENALTY = 10;

/** AI 후보가 아니라 안전관리자가 위험으로 확정한 사건만 조 점수에 반영한다. */
export function teamScoreFromConfirmed(confirmedCount: number) {
  const penalty = Math.max(0, confirmedCount) * CONFIRMED_EVENT_PENALTY;
  return {
    score: Math.max(0, BASE_SCORE - penalty),
    penalty,
  };
}

export function scoreTone(score: number) {
  if (score >= 90) return "var(--safe)";
  if (score >= 70) return "var(--hold)";
  return "var(--deny)";
}

export function scoreLabel(score: number) {
  if (score >= 90) return "양호";
  if (score >= 70) return "주의";
  return "개선 필요";
}
