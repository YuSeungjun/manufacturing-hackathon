import { prisma } from "@/lib/prisma";
import { dayRange, todayLocalISO } from "@/lib/date";

/**
 * 오늘의 흐름.
 *
 * 이 앱에는 실제 순서가 있다 — TBM 작성 → 확인 서명 → 영상 분석 → 탐지 검토.
 * 레일과 홈 보드가 같은 값을 보게 하려고 여기 한 곳에서만 계산한다.
 */

export type StageState =
  /** 오늘 몫이 끝났다 */
  | "done"
  /** 지금 안전관리자가 손대야 한다 */
  | "active"
  /** 아직 안 됐지만 급하지 않다 (작업자 몫이거나 순서가 안 왔다) */
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

export type ManagerFlow = {
  stages: FlowStage[];
  tbmCount: number;
  signed: number;
  expected: number;
  analyzed: number;
  pending: number;
  confirmed: number;
  /** 지금 당장 해야 할 한 가지. 없으면 null. */
  next: { label: string; href: string; cta: string } | null;
};

export async function managerFlow(workplaceId: string): Promise<ManagerFlow> {
  const { from, to } = dayRange(todayLocalISO());
  const scope = { workplaceId };

  const [tbms, detections] = await Promise.all([
    prisma.tbm.findMany({
      where: { ...scope, workDate: { gte: from, lt: to } },
      // 서명 대상은 TBM 마다 지정된다. 작업조 전원이 아니다.
      include: { acknowledgements: true, assignees: true },
    }),
    prisma.detection.findMany({
      where: { tbm: scope, detectedAt: { gte: from, lt: to } },
      select: { status: true },
    }),
  ]);

  let signed = 0;
  let expected = 0;
  for (const tbm of tbms) {
    const targets = new Set(tbm.assignees.map((a) => a.userId));
    expected += targets.size;
    signed += tbm.acknowledgements.filter((ack) => targets.has(ack.userId)).length;
  }

  const tbmCount = tbms.length;
  const analyzed = detections.length;
  const pending = detections.filter((d) => d.status === "PENDING").length;
  const confirmed = detections.filter((d) => d.status === "CONFIRMED").length;

  const stages: FlowStage[] = [
    {
      stage: 1,
      href: "/manager/tbm/new",
      label: "TBM 작성",
      short: "TBM",
      value: tbmCount > 0 ? `${tbmCount}` : "필요",
      state: tbmCount > 0 ? "done" : "active",
    },
    {
      stage: 2,
      href: "/manager/signatures",
      label: "확인 서명",
      short: "서명",
      value: expected === 0 ? "—" : `${signed}/${expected}`,
      state: expected === 0 ? "idle" : signed >= expected ? "done" : "todo",
    },
    {
      stage: 3,
      href: "/manager/analyze",
      label: "영상 분석",
      short: "분석",
      value: `${analyzed}`,
      state: analyzed > 0 ? "done" : tbmCount > 0 ? "todo" : "idle",
    },
    {
      stage: 4,
      href: "/manager/detections",
      label: "탐지 검토",
      short: "검토",
      value: `${pending}`,
      state: pending > 0 ? "active" : analyzed > 0 ? "done" : "idle",
    },
  ];

  return { stages, tbmCount, signed, expected, analyzed, pending, confirmed, next: nextAction() };

  /** 지금 할 일은 하나만 고른다. 검토 대기 > TBM 미작성 > 서명 미완 순. */
  function nextAction() {
    if (pending > 0) {
      return {
        label: `검토 대기 ${pending}건이 판단을 기다립니다`,
        href: "/manager/detections",
        cta: "검토하러 가기",
      };
    }
    if (tbmCount === 0) {
      return {
        label: "오늘 작업일의 TBM이 아직 없습니다",
        href: "/manager/tbm/new",
        cta: "TBM 작성하기",
      };
    }
    if (expected > 0 && signed < expected) {
      return {
        label: `작업자 ${expected - signed}명이 안전수칙 확인 서명을 하지 않았습니다`,
        href: "/manager/signatures",
        cta: "서명 현황 보기",
      };
    }
    return null;
  }
}
