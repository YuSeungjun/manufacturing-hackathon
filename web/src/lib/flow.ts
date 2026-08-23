import { prisma } from "@/lib/prisma";
import { dayRange, todayLocalISO } from "@/lib/date";

/**
 * 오늘의 흐름.
 *
 * 이 앱에는 실제 순서가 있다 — 위험구역 설정 → 영상 분석 → 위험 사건 검토 → 재가동 승인.
 * 레일과 홈 보드가 같은 값을 보게 하려고 여기 한 곳에서만 계산한다.
 */

export type StageState =
  /** 오늘 몫이 끝났다 */
  | "done"
  /** 지금 손대야 한다 */
  | "active"
  /** 아직 안 됐지만 급하지 않다 */
  | "todo"
  /** 해당 없음 */
  | "idle";

export type FlowStage = {
  stage: number;
  href: string;
  label: string;
  /** 모바일 하단 탭에서 쓰는 짧은 이름 */
  short: string;
  /** 오른쪽에 붙는 계측값. 숫자만 모노로 조판된다. */
  value: string;
  state: StageState;
};

export type NextAction = { label: string; href: string; cta: string } | null;

export type ManagerFlow = {
  stages: FlowStage[];
  equipmentCount: number;
  zoneCount: number;
  analyzed: number;
  pendingEvents: number;
  criticalEvents: number;
  blockedRestarts: number;
  blockedEquipment: number;
  next: NextAction;
};

export async function managerFlow(workplaceId: string): Promise<ManagerFlow> {
  const { from, to } = dayRange(todayLocalISO());
  const scope = { workplaceId };

  const [equipmentCount, zoneCount, analyzed, events, blockedRestarts, blockedEquipment] =
    await Promise.all([
      prisma.equipment.count({ where: scope }),
      prisma.dangerZone.count({ where: { active: true, equipment: scope } }),
      prisma.videoAnalysis.count({ where: { ...scope, analyzedAt: { gte: from, lt: to } } }),
      prisma.riskEvent.findMany({
        where: { ...scope, detectedAt: { gte: from, lt: to } },
        select: { status: true, level: true },
      }),
      prisma.restartRequest.count({
        where: { ...scope, decision: "BLOCKED", outcome: "OPEN", approvedAt: null },
      }),
      prisma.equipment.count({ where: { ...scope, interlock: "BLOCKED" } }),
    ]);

  const pendingEvents = events.filter((e) => e.status === "PENDING").length;
  const criticalEvents = events.filter((e) => e.level === "CRITICAL").length;

  const stages: FlowStage[] = [
    {
      stage: 1,
      href: "/manager/equipment",
      label: "위험구역 설정",
      short: "구역",
      value: zoneCount > 0 ? `${zoneCount}` : "필요",
      state: zoneCount > 0 ? "done" : "active",
    },
    {
      stage: 2,
      href: "/manager/analyze",
      label: "영상 분석",
      short: "분석",
      value: `${analyzed}`,
      state: analyzed > 0 ? "done" : zoneCount > 0 ? "todo" : "idle",
    },
    {
      stage: 3,
      href: "/manager/events",
      label: "위험 사건",
      short: "사건",
      value: `${pendingEvents}`,
      state: pendingEvents > 0 ? "active" : events.length > 0 ? "done" : "idle",
    },
    {
      stage: 4,
      href: "/manager/restarts",
      label: "재가동 승인",
      short: "승인",
      value: `${blockedRestarts}`,
      state: blockedRestarts > 0 ? "active" : "idle",
    },
  ];

  return {
    stages,
    equipmentCount,
    zoneCount,
    analyzed,
    pendingEvents,
    criticalEvents,
    blockedRestarts,
    blockedEquipment,
    next: nextAction(),
  };

  /**
   * 지금 할 일은 하나만 고른다.
   * 사람이 차단당한 채 라인 앞에 서 있는 상황이 가장 급하다.
   */
  function nextAction(): NextAction {
    if (blockedRestarts > 0) {
      return {
        label: `재가동 요청 ${blockedRestarts}건이 차단된 채 승인을 기다립니다`,
        href: "/manager/restarts",
        cta: "현장 확인하러 가기",
      };
    }
    if (pendingEvents > 0) {
      return {
        label: `위험 사건 ${pendingEvents}건이 판단을 기다립니다`,
        href: "/manager/events",
        cta: "검토하러 가기",
      };
    }
    if (zoneCount === 0) {
      return {
        label: "아직 위험구역이 설정되지 않았습니다",
        href: "/manager/equipment",
        cta: "위험구역 그리기",
      };
    }
    if (analyzed === 0) {
      return {
        label: "오늘 분석한 CCTV 영상이 없습니다",
        href: "/manager/analyze",
        cta: "영상 분석하기",
      };
    }
    return null;
  }
}

export type OperatorFlow = { stages: FlowStage[]; blocked: number; awaiting: number; ready: number };

export async function operatorFlow(workplaceId: string, userId: string): Promise<OperatorFlow> {
  const [equipment, awaiting] = await Promise.all([
    prisma.equipment.findMany({ where: { workplaceId }, select: { interlock: true } }),
    prisma.restartRequest.count({
      where: { workplaceId, requestedById: userId, decision: "BLOCKED", outcome: "OPEN", approvedAt: null },
    }),
  ]);
  const blocked = equipment.filter((e) => e.interlock === "BLOCKED").length;
  const ready = equipment.length - blocked;

  return {
    blocked,
    awaiting,
    ready,
    stages: [
      {
        stage: 1,
        href: "/operator",
        label: "설비 상태",
        short: "설비",
        value: `${ready}/${equipment.length}`,
        state: blocked > 0 ? "todo" : "done",
      },
      {
        stage: 2,
        href: "/operator/requests",
        label: "내 재가동 요청",
        short: "요청",
        value: `${awaiting}`,
        state: awaiting > 0 ? "active" : "idle",
      },
    ],
  };
}

export type WorkerFlow = { stages: FlowStage[]; myLocks: number; openLocks: number; alerts: number };

export async function workerFlow(workplaceId: string, userId: string): Promise<WorkerFlow> {
  const { from, to } = dayRange(todayLocalISO());
  const [locks, alerts] = await Promise.all([
    prisma.lotoLock.findMany({
      where: { userId, work: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
      select: { releasedAt: true },
    }),
    prisma.riskEvent.count({
      where: { workplaceId, detectedAt: { gte: from, lt: to }, level: { in: ["WARNING", "CRITICAL"] } },
    }),
  ]);
  const openLocks = locks.filter((l) => l.releasedAt === null).length;

  return {
    myLocks: locks.length,
    openLocks,
    alerts,
    stages: [
      {
        stage: 1,
        href: "/worker",
        label: "오늘의 정비 작업",
        short: "작업",
        value: `${locks.length}`,
        state: locks.length > 0 ? "done" : "idle",
      },
      {
        stage: 2,
        href: "/worker#loto",
        label: "개인 시건",
        short: "시건",
        value: openLocks > 0 ? `${openLocks} 시건중` : "해제됨",
        state: openLocks > 0 ? "active" : locks.length > 0 ? "done" : "idle",
      },
      {
        stage: 3,
        href: "/worker#alerts",
        label: "안전 알림",
        short: "알림",
        value: `${alerts}`,
        state: alerts > 0 ? "todo" : "idle",
      },
    ],
  };
}
