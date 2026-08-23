import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { DateNav } from "@/components/DateNav";
import { acknowledgeTbmAction } from "@/app/actions/tbm";
import { Empty, JudgmentStamp, PageHead, SectionHead, StatusTag } from "@/components/ui";
import { dayRange, formatDate, formatIsoDateKo, formatTime, resolveDateParam, todayLocalISO } from "@/lib/date";
import type { FlowStage } from "@/lib/flow";
import { DETECTION_TYPE_LABEL, SEVERITY_LABEL, ppeLabel } from "@/lib/ppe";
import { scoreTone, teamScore } from "@/lib/score";

const SEVERITY_TAG: Record<string, string> = {
  HIGH: "tag-deny",
  MEDIUM: "tag-hold",
  LOW: "",
};

export default async function WorkerPage({ searchParams }: PageProps<"/worker">) {
  const user = await requireUser();

  const today = todayLocalISO();
  const iso = resolveDateParam((await searchParams).date);
  const isToday = iso === today;
  const dayLabel = isToday ? "오늘" : formatIsoDateKo(iso);
  const { from, to } = dayRange(iso);

  const canManage = user.role === "SAFETY_MANAGER" && user.approvalStatus === "APPROVED";
  const switchTo = canManage ? { href: "/manager", label: "안전관리자 화면" } : undefined;

  if (!user.teamId) {
    return (
      <AppShell user={user} overviewHref="/worker" stages={[]} switchTo={switchTo}>
        <PageHead
          title="배정된 작업조가 없습니다"
          sub="안전관리자에게 작업조 배정을 요청해 주세요."
        />
      </AppShell>
    );
  }

  // 나에게 배정된 TBM 만 본다. 같은 조라도 오늘 투입되지 않았으면 서명 대상이 아니다.
  const tbms = await prisma.tbm.findMany({
    where: {
      workDate: { gte: from, lt: to },
      assignees: { some: { userId: user.id } },
    },
    orderBy: { createdAt: "asc" },
    include: { rules: { orderBy: { order: "asc" } }, createdBy: true, acknowledgements: true },
  });

  const myDetections = await prisma.detection.findMany({
    where: { tbm: { teamId: user.teamId }, detectedAt: { gte: from, lt: to } },
    orderBy: { detectedAt: "desc" },
    include: { safetyRule: true, review: true },
  });

  // 오늘 것이 없을 때, 다른 날짜에 배정된 TBM 이 있으면 알려 준다.
  const latestTbm =
    tbms.length === 0
      ? await prisma.tbm.findFirst({
          where: { assignees: { some: { userId: user.id } } },
          orderBy: { workDate: "desc" },
          select: { workDate: true, workType: true },
        })
      : null;

  const score = await teamScore(user.teamId, from, to);
  const confirmed = myDetections.filter((d) => d.status === "CONFIRMED");
  const unsigned = tbms.filter((t) => !t.acknowledgements.some((a) => a.userId === user.id));

  // 작업자의 흐름은 셋뿐이다 — 읽고, 서명하고, 결과를 본다.
  const stages: FlowStage[] = [
    {
      stage: 1,
      href: "/worker",
      label: "오늘의 TBM",
      short: "TBM",
      value: `${tbms.length}`,
      state: tbms.length > 0 ? "done" : "idle",
    },
    {
      stage: 2,
      href: "/worker#sign",
      label: "확인 서명",
      short: "서명",
      value: unsigned.length > 0 ? `${unsigned.length}` : "✓",
      state: tbms.length === 0 ? "idle" : unsigned.length > 0 ? "active" : "done",
    },
    {
      stage: 3,
      href: "/worker#alerts",
      label: "안전 알림",
      short: "알림",
      value: `${myDetections.length}`,
      state: confirmed.length > 0 ? "active" : myDetections.length > 0 ? "done" : "idle",
    },
  ];

  return (
    <AppShell user={user} overviewHref="/worker" stages={stages} switchTo={switchTo}>
      <PageHead
        eyebrow={
          <span className="tag">
            {user.team?.name} · {user.team?.workArea}
          </span>
        }
        title={isToday ? `${user.name} 님, 오늘도 안전하게` : `${user.name} 님의 ${dayLabel} 기록`}
        action={<DateNav basePath="/worker" iso={iso} today={today} />}
      />

      {/* 작업자가 알아야 할 두 가지 — 우리 조 점수, 그리고 내가 서명했는지. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <div className="paper flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">우리 조 {dayLabel} 안전이행 점수</p>
            <p className="mt-1.5 text-[13px] text-ink-3">
              안전관리자가 확정한 위반 <span className="num">{score.confirmedCount}</span>건 · 감점{" "}
              <span className="num">{score.penalty}</span>점
            </p>
          </div>
          <p className="sign shrink-0 text-[3.25rem] leading-none" style={{ color: scoreTone(score.score) }}>
            {score.score}
            <span className="ml-1 text-[1rem] font-medium text-ink-3">/100</span>
          </p>
        </div>

        <div
          className="rounded-lg border-2 px-4 py-3.5"
          style={
            unsigned.length > 0
              ? { borderColor: "var(--act)", background: "var(--act-soft)" }
              : { borderColor: "var(--rule)", background: "var(--paper)" }
          }
        >
          <p className="eyebrow">{dayLabel}의 확인 서명</p>
          {unsigned.length > 0 ? (
            <p className="mt-1.5 text-[14px] font-bold leading-6">
              <span className="num">{unsigned.length}</span>건의 TBM에 서명이{" "}
              {isToday ? "남았습니다. 아래에서 안전수칙을 읽고 서명해 주세요." : "없습니다."}
            </p>
          ) : (
            <p className="mt-1.5 text-[14px] leading-6 text-ink-2">
              {tbms.length > 0
                ? `${dayLabel} 배정된 TBM에 모두 서명했습니다.`
                : `${dayLabel} 배정된 TBM이 없습니다.`}
            </p>
          )}
        </div>
      </div>

      <section id="sign" className="mt-7 scroll-mt-20">
        <SectionHead title={`${dayLabel}의 TBM`} count={`${tbms.length}건`} />
        {tbms.length === 0 ? (
          <Empty>
            {dayLabel} 배정된 TBM이 없습니다.{" "}
            {latestTbm ? (
              <>
나에게 배정된 가장 최근 TBM은{" "}
                <b className="text-ink-2">
                  {formatDate(latestTbm.workDate)}
                </b>{" "}
                「{latestTbm.workType}」입니다. 안전관리자에게 작업일을 확인해 주세요.
              </>
            ) : (
              "안전관리자가 작성하면 여기에 나타납니다."
            )}
          </Empty>
        ) : (
          <div className="space-y-4">
            {tbms.map((tbm) => {
              const signed = tbm.acknowledgements.some((a) => a.userId === user.id);
              return (
                <section key={tbm.id} className="paper">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <h3 className="text-[1.0625rem] font-extrabold tracking-[-0.01em]">
                        {tbm.workType}
                      </h3>
                      <p className="mt-0.5 text-[12.5px] text-ink-3">
                        {tbm.workArea} · 작성 {tbm.createdBy.name}
                      </p>
                    </div>
                    {signed ? <span className="stamp stamp-safe">확인 완료</span> : null}
                  </div>

                  {tbm.summary ? (
                    <p className="well mt-3.5 text-[14px] leading-6">{tbm.summary}</p>
                  ) : null}

                  <ol className="mt-3.5 rounded-md border border-rule-soft ruled">
                    {tbm.rules.map((rule) => (
                      <li key={rule.id} className="flex items-start gap-3 px-3.5 py-3">
                        <span className="num mt-0.5 w-4 shrink-0 text-[12.5px] font-bold text-ink-3">
                          {rule.order}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold">{rule.description}</p>
                          <p className="mt-1 text-[13px] leading-6 text-ink-2">
                            위험 요인 · {rule.hazard}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <span className={`tag ${SEVERITY_TAG[rule.severity] ?? ""}`}>
                              위험도 {SEVERITY_LABEL[rule.severity]}
                            </span>
                            <span className={`tag ${rule.ppeCode ? "tag-act" : ""}`}>
                              {DETECTION_TYPE_LABEL[rule.detectionType]}
                              {rule.ppeCode ? " · AI 확인" : ""}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>

                  {signed ? null : isToday ? (
                    <form action={acknowledgeTbmAction} className="mt-4">
                      <input type="hidden" name="tbmId" value={tbm.id} />
                      <button type="submit" className="btn-act w-full sm:w-auto sm:px-6">
                        안전수칙 확인하고 서명
                      </button>
                    </form>
                  ) : (
                    // 지난 날짜는 기록이다. 작업 전에 했어야 할 서명을 소급해 받지 않는다.
                    <p className="mt-4 text-[13px] text-ink-3">서명하지 않은 채로 기록되었습니다.</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>

      <section id="alerts" className="mt-7 scroll-mt-20">
        <SectionHead title="나의 안전 알림" count={`${myDetections.length}건`} />
        <p className="-mt-1 mb-2.5 text-[13px] leading-6 text-ink-2">
          AI 탐지 결과 중 안전관리자가 최종 판정한 건만 점수에 반영됩니다.
        </p>

        {myDetections.length === 0 ? (
          <Empty>{dayLabel} 전달된 알림이 없습니다.</Empty>
        ) : (
          <ul className="paper-flush ruled">
            {myDetections.map((detection) => (
              <li key={detection.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {ppeLabel(detection.ppeCode)}
                    <span className="num ml-2 text-[12px] font-normal text-ink-3">
                      {formatTime(detection.detectedAt)}
                    </span>
                    <span className="ml-1.5 text-[12.5px] font-normal text-ink-3">
                      {detection.location}
                    </span>
                  </p>
                  {detection.review?.comment ? (
                    <p className="mt-1 text-[13px] leading-6 text-ink-2">
                      안전관리자 의견 · {detection.review.comment}
                    </p>
                  ) : null}
                </div>
                {detection.status === "CONFIRMED" ? (
                  <span className="text-[13px] font-bold" style={{ color: "var(--deny)" }}>
                    <span className="num">−{detection.safetyRule?.penalty ?? 10}</span>점
                  </span>
                ) : null}
                {detection.status === "PENDING" ? (
                  <StatusTag status={detection.status} />
                ) : (
                  <JudgmentStamp decision={detection.status} />
                )}
              </li>
            ))}
          </ul>
        )}

        {confirmed.length > 0 ? (
          <p
            className="mt-3 rounded-lg border-2 px-4 py-3.5 text-[14px] leading-6"
            style={{ borderColor: "var(--deny)", background: "var(--deny-soft)" }}
          >
            {dayLabel} <b><span className="num">{confirmed.length}</span>건</b>의 위반이 확정되었습니다.
            다음 작업 전에 해당 보호구 착용 상태를 반드시 확인해 주세요.
          </p>
        ) : null}
      </section>
    </AppShell>
  );
}
