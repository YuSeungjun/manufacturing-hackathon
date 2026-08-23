export const BASE_SCORE = 100;
export const CONFIRMED_EVENT_PENALTY = 10;

/**
 * 되풀이는 배로 무겁게 매긴다 — 10 → 20 → 40 → 80.
 *
 * 같은 조가 하루에 두 번, 세 번 걸리는 건 운이 나쁜 게 아니라 그 조의 작업 방식이
 * 안 고쳐졌다는 뜻이다. 매번 같은 10점이면 두 번째 위반이 첫 번째보다 가볍게 느껴진다.
 *
 * 80 에서 멈춘다. 기준점이 100 이라 그 위로 올려 봐야 0 에 눌려 차이가 사라지고,
 * 숫자만 커져 무슨 뜻인지 알 수 없게 된다.
 */
export const MAX_EVENT_PENALTY = 80;

/** 오늘 그 조에 이미 부과된 확정 건수를 받아 이번 건의 벌점을 낸다. */
export function penaltyForRepeat(priorCount: number) {
  const repeats = Math.max(0, Math.floor(priorCount));
  return Math.min(MAX_EVENT_PENALTY, CONFIRMED_EVENT_PENALTY * 2 ** repeats);
}

/** 몇 번째 위반인지, 그리고 그 다음은 얼마인지. 화면이 미리 알려 주려고 쓴다. */
export function penaltyLadder(priorCount: number) {
  const points = penaltyForRepeat(priorCount);
  return {
    /** 이번이 오늘 몇 번째인가 (1부터) */
    ordinal: Math.max(0, Math.floor(priorCount)) + 1,
    points,
    /** 이번에 부과하면 다음 건은 얼마가 되는가 */
    next: penaltyForRepeat(priorCount + 1),
    capped: points >= MAX_EVENT_PENALTY,
  };
}

/**
 * 조 점수는 **부과된 벌점의 합**으로 낸다.
 *
 * 건수 × 10 으로 세면 누진이 사라진다 — 20 점을 물린 건도 10 점으로 되돌아간다.
 * 부과할 때 정한 점수가 그대로 점수판에 실려야 사람이 그 감점을 설명할 수 있다.
 */
export function teamScoreFromPenalty(penaltyPoints: number) {
  const penalty = Math.max(0, penaltyPoints);
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
