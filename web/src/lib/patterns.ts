/**
 * 반복 패턴 — "사고를 감지한다" 에서 "사고가 나기 전에 반복되는 작업을 찾는다" 로 넘어가는 자리.
 *
 * 개별 위험 사건은 그날 그 사람 이야기다. 같은 설비에서 같은 상황이 한 달에 마흔두 번
 * 반복됐다면 그건 사람 이야기가 아니라 설비 이야기고, 고칠 수 있는 대상이 된다.
 *
 * 금액은 우리가 추정하지 않는다. 설비마다 관리자가 넣은 분당 손실단가가 0 이면 금액 칸을
 * 아예 만들지 않는다 — 근거 없는 원화 숫자 하나가 발표 전체의 신뢰를 깎는다.
 */

import { prisma } from "@/lib/prisma";
import { SITE_ZONE } from "@/lib/date";

// ── 경고 임계값 ─────────────────────────────────────────
// 숫자를 화면과 로직에 흩뿌리지 않는다. 심사에서 "왜 3번이냐"를 물으면 여기를 열면 된다.

/** 이만큼 반복되면 "반복"이라고 부른다. 2회는 우연일 수 있다. */
const REPEAT_MIN = 3;
/** 집중도 경고를 켜기 위한 최소 표본. 3건 중 2건으로 "67% 집중"이라 말하면 통계가 아니다. */
const CONCENTRATION_MIN_SAMPLE = 5;
/** 한 설비가 전체 위험접근의 이 비율을 넘으면 집중으로 본다. */
const CONCENTRATION_RATIO = 0.5;
/** 평균 복구시간이 전체 평균의 이 배수를 넘으면 따로 짚는다. */
const SLOW_RECOVERY_FACTOR = 1.5;

export type EquipmentPattern = {
  equipmentId: string;
  code: string;
  name: string;
  kind: string;
  line: string;
  downtimeCostPerMin: number;

  /** 정지 에피소드 전체 (계획 정비 포함) */
  episodes: number;
  /** 그중 걸림 대응으로 분류된 것 */
  jamEpisodes: number;
  /** 그중 위험구역 접근이 동반된 것 — 이게 실제 위험 신호다 */
  approachEpisodes: number;
  /** 걸림 대응 중 위험접근이 동반된 비율 */
  approachRatio: number | null;

  avgRecoverySec: number | null;
  /** 걸림 대응 정지의 합. 계획 정비와 진행 중인 에피소드는 빠진다. */
  totalDowntimeSec: number;
  /** 단가가 0 이면 null — 금액을 만들지 않는다 */
  costWon: number | null;

  /** 현장 시간대 기준 시간대별 걸림 횟수 */
  byHour: number[];
};

export type PatternAlert = {
  code: "REPEAT_APPROACH" | "CONCENTRATED" | "SLOW_RECOVERY";
  severity: "HIGH" | "MEDIUM";
  equipmentId: string | null;
  /** 화면에 그대로 나가는 한 문장 */
  headline: string;
  /** 그 문장의 근거 */
  detail: string;
};

export type PatternReport = {
  episodes: number;
  jamEpisodes: number;
  approachEpisodes: number;
  totalDowntimeSec: number;
  avgRecoverySec: number | null;
  /** 단가가 하나라도 설정된 설비가 있을 때만 값이 있다 */
  totalCostWon: number | null;
  /** 단가가 안 잡힌 설비가 있으면 금액이 과소집계된다는 뜻이다. 화면에서 각주로 쓴다. */
  costCoverage: { priced: number; total: number };
  byEquipment: EquipmentPattern[];
  alerts: PatternAlert[];
};

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_ZONE,
  hour: "2-digit",
  hour12: false,
});

function siteHour(date: Date): number {
  return Number(hourFormatter.format(date)) % 24;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function patternReport(
  workplaceId: string,
  from: Date,
  to: Date,
): Promise<PatternReport> {
  const [equipment, episodes] = await Promise.all([
    prisma.equipment.findMany({
      where: { workplaceId },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        line: true,
        downtimeCostPerMin: true,
      },
      orderBy: { code: "asc" },
    }),
    prisma.stoppageEpisode.findMany({
      where: { workplaceId, startedAt: { gte: from, lt: to } },
      select: {
        equipmentId: true,
        cause: true,
        riskApproach: true,
        recoverySec: true,
        restartedAt: true,
        startedAt: true,
      },
    }),
  ]);

  const byId = new Map<string, EquipmentPattern>();
  for (const item of equipment) {
    byId.set(item.id, {
      equipmentId: item.id,
      code: item.code,
      name: item.name,
      kind: item.kind,
      line: item.line,
      downtimeCostPerMin: item.downtimeCostPerMin,
      episodes: 0,
      jamEpisodes: 0,
      approachEpisodes: 0,
      approachRatio: null,
      avgRecoverySec: null,
      totalDowntimeSec: 0,
      costWon: null,
      byHour: Array<number>(24).fill(0),
    });
  }

  const recoveries = new Map<string, number[]>();

  for (const episode of episodes) {
    const row = byId.get(episode.equipmentId);
    if (!row) continue;

    row.episodes += 1;
    if (episode.cause === "JAM") {
      row.jamEpisodes += 1;
      row.byHour[siteHour(episode.startedAt)] += 1;
    }
    if (episode.riskApproach) row.approachEpisodes += 1;

    // 진행 중인 에피소드(재가동 전)는 복구시간에 넣지 않는다. 0 을 평균에 섞으면 짧아 보인다.
    //
    // 계획 정비는 중단시간과 금액에서 뺀다. 예정된 정지는 손실이 아니라 계획이고,
    // 그걸 손실에 넣으면 "정비를 하면 손해"라는 거짓말이 된다. 걸림 대응만 센다.
    if (episode.restartedAt && episode.cause === "JAM") {
      row.totalDowntimeSec += episode.recoverySec;
      const list = recoveries.get(episode.equipmentId) ?? [];
      list.push(episode.recoverySec);
      recoveries.set(episode.equipmentId, list);
    }
  }

  for (const row of byId.values()) {
    row.avgRecoverySec = avg(recoveries.get(row.equipmentId) ?? []);
    row.approachRatio = row.jamEpisodes > 0 ? row.approachEpisodes / row.jamEpisodes : null;
    // 걸림으로 인한 중단이 0 이면 금액도 없다. "0원" 은 계산했다는 뜻이라 오해를 만든다.
    row.costWon =
      row.downtimeCostPerMin > 0 && row.totalDowntimeSec > 0
        ? Math.round((row.totalDowntimeSec / 60) * row.downtimeCostPerMin)
        : null;
  }

  // 에피소드가 하나도 없는 설비는 표에서 뺀다. 빈 줄이 스무 개면 표를 아무도 안 읽는다.
  const rows = [...byId.values()]
    .filter((r) => r.episodes > 0)
    .sort((a, b) => b.approachEpisodes - a.approachEpisodes || b.jamEpisodes - a.jamEpisodes);

  const totalEpisodes = rows.reduce((s, r) => s + r.episodes, 0);
  const totalJam = rows.reduce((s, r) => s + r.jamEpisodes, 0);
  const totalApproach = rows.reduce((s, r) => s + r.approachEpisodes, 0);
  const totalDowntimeSec = rows.reduce((s, r) => s + r.totalDowntimeSec, 0);
  const allRecoveries = [...recoveries.values()].flat();

  // 커버리지는 "단가가 입력됐는가" 로 센다. 걸림이 없어서 금액이 0 인 설비는 단가 미입력이
  // 아니다 — 둘을 섞으면 화면 각주가 거짓말을 한다.
  const pricedRows = rows.filter((r) => r.downtimeCostPerMin > 0);
  const totalCostWon =
    pricedRows.length > 0 ? pricedRows.reduce((s, r) => s + (r.costWon ?? 0), 0) : null;

  return {
    episodes: totalEpisodes,
    jamEpisodes: totalJam,
    approachEpisodes: totalApproach,
    totalDowntimeSec,
    avgRecoverySec: avg(allRecoveries),
    totalCostWon,
    costCoverage: { priced: pricedRows.length, total: rows.length },
    byEquipment: rows,
    alerts: buildAlerts(rows, totalApproach, avg(allRecoveries)),
  };
}

/**
 * 경고 문장.
 *
 * 임계값을 넘겼다는 사실만 말하고 "위험합니다" 같은 형용사를 붙이지 않는다. 관리자가
 * 읽고 바로 A컨베이어를 보러 갈 수 있는 문장이면 충분하다.
 */
function buildAlerts(
  rows: EquipmentPattern[],
  totalApproach: number,
  overallAvgRecovery: number | null,
): PatternAlert[] {
  const alerts: PatternAlert[] = [];

  for (const row of rows) {
    if (row.approachEpisodes >= REPEAT_MIN) {
      alerts.push({
        code: "REPEAT_APPROACH",
        severity: "HIGH",
        equipmentId: row.equipmentId,
        headline: `${row.name}에서 정지 후 위험구역 접근이 ${row.approachEpisodes}회 반복되고 있습니다.`,
        detail:
          row.jamEpisodes > 0
            ? `걸림 대응 ${row.jamEpisodes}건 중 ${row.approachEpisodes}건에서 작업자가 위험구역에 들어갔습니다.`
            : `정지 ${row.episodes}건 중 ${row.approachEpisodes}건에서 작업자가 위험구역에 들어갔습니다.`,
      });
    }
  }

  const top = rows[0];
  if (
    top &&
    totalApproach >= CONCENTRATION_MIN_SAMPLE &&
    top.approachEpisodes / totalApproach >= CONCENTRATION_RATIO
  ) {
    const percent = Math.round((top.approachEpisodes / totalApproach) * 100);
    alerts.push({
      code: "CONCENTRATED",
      severity: "HIGH",
      equipmentId: top.equipmentId,
      headline: `위험구역 접근 ${totalApproach}건 중 ${top.approachEpisodes}건이 ${top.name}에서 발생했습니다.`,
      detail: `한 설비가 전체의 ${percent}% 를 차지합니다. 작업 방법이 아니라 설비 쪽을 봐야 하는 신호입니다.`,
    });
  }

  if (overallAvgRecovery != null && overallAvgRecovery > 0) {
    for (const row of rows) {
      if (row.avgRecoverySec == null || row.jamEpisodes < REPEAT_MIN) continue;
      if (row.avgRecoverySec < overallAvgRecovery * SLOW_RECOVERY_FACTOR) continue;
      alerts.push({
        code: "SLOW_RECOVERY",
        severity: "MEDIUM",
        equipmentId: row.equipmentId,
        headline: `${row.name}의 평균 복구시간이 전체 평균보다 깁니다.`,
        detail: `이 설비 ${Math.round(row.avgRecoverySec)}초 vs 전체 ${Math.round(overallAvgRecovery)}초. 복구가 길수록 작업자가 위험구역에 머무는 시간도 길어집니다.`,
      });
    }
  }

  return alerts;
}

export const EQUIPMENT_KIND_LABEL: Record<string, string> = {
  CONVEYOR: "컨베이어",
  ROLLING_MILL: "압연설비",
  OTHER: "기타 설비",
};

/** 금액 표기. 만 원 아래는 버린다 — 원 단위까지 적으면 추정값처럼 안 보인다. */
export function formatWon(won: number): string {
  if (won >= 100_000_000) return `${(won / 100_000_000).toFixed(1)}억 원`;
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString("ko-KR")}만 원`;
  return `${won.toLocaleString("ko-KR")}원`;
}
