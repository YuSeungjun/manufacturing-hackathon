import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { workerFlow } from "@/lib/flow";
import { AppShell } from "@/components/AppShell";
import { PageHead, SectionHead, Empty, LevelTag, InterlockBadge, Metric } from "@/components/ui";
import { LotoList } from "@/components/LotoList";
import { dayRange, formatDurationKo, formatStamp, todayLocalISO } from "@/lib/date";
import { riskCodeLabel } from "@/lib/zone";
import {
  CONFIRMED_EVENT_PENALTY,
  MAX_EVENT_PENALTY,
  scoreLabel,
  scoreTone,
  teamScoreFromPenalty,
} from "@/lib/score";
import { LotoButtons } from "./LotoButtons";

export default async function WorkerPage() {
  const user = await requireUser();
  const flow = await workerFlow(user.workplaceId, user.id);
  const { from, to } = dayRange(todayLocalISO());

  const [works, alerts, myPenalties] = await Promise.all([
    prisma.maintenanceWork.findMany({
      where: {
        workplaceId: user.workplaceId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        assignees: { some: { userId: user.id } },
      },
      orderBy: { workDate: "desc" },
      include: {
        equipment: true,
        assignees: { include: { user: { select: { id: true, name: true, employeeNumber: true } } } },
        locks: true,
      },
    }),
    prisma.riskEvent.findMany({
      where: {
        workplaceId: user.workplaceId,
        detectedAt: { gte: from, lt: to },
        level: { in: ["WARNING", "CRITICAL"] },
      },
      orderBy: { detectedAt: "desc" },
      take: 8,
      include: { zone: true, equipment: { select: { code: true, name: true } } },
    }),
    /*
     * 내 조에 **오늘 부과된** 벌점. 안전관리자 현황판과 같은 기준(resolvedAt)으로 센다 —
     * 같은 점수가 두 화면에서 다르게 보이면 작업자는 둘 다 안 믿는다.
     *
     * 다른 조 점수는 가져오지 않는다. 자기 조를 확인하러 들어온 화면이지 조끼리
     * 줄 세우는 화면이 아니다.
     */
    user.teamId
      ? prisma.riskEvent.findMany({
          where: {
            workplaceId: user.workplaceId,
            status: "CONFIRMED",
            chargedTeamId: user.teamId,
            resolvedAt: { gte: from, lt: to },
          },
          orderBy: { resolvedAt: "desc" },
          select: { penaltyPoints: true },
        })
      : Promise.resolve([]),
  ]);

  const myPenalty = myPenalties.reduce((sum, row) => sum + row.penaltyPoints, 0);
  const myScore = teamScoreFromPenalty(myPenalty).score;
  const myTone = scoreTone(myScore);

  return (
    <AppShell user={user} overviewHref="/worker" stages={flow.stages}>
      <div className="flex flex-col gap-7">
        <PageHead
          title="내 정비 작업"
          sub="설비 안에서 작업하는 동안 개인 시건을 걸어 두세요. 시건이 하나라도 남아 있으면 이 설비는 재가동되지 않습니다."
        />

        <section id="loto" className="flex flex-col gap-3">
          <SectionHead title="오늘의 작업" count={`${works.length}건`} />
          {works.length === 0 ? (
            <Empty>배정된 정비 작업이 없습니다.</Empty>
          ) : (
            <ul className="flex flex-col gap-4">
              {works.map((work) => {
                const myLock = work.locks.find((l) => l.userId === user.id);
                const openLocks = work.locks.filter((l) => l.releasedAt === null);
                return (
                  <li key={work.id} className="paper flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-[12.5px] font-bold text-ink-3">
                        {work.equipment.code}
                      </span>
                      <h3 className="text-[15px] font-bold">{work.title}</h3>
                      <InterlockBadge
                        interlock={work.equipment.interlock}
                        reason={work.equipment.interlockReason}
                      />
                    </div>

                    {work.summary ? (
                      <p className="text-[13.5px] leading-6 text-ink-2">{work.summary}</p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <Metric label="설비" value={work.equipment.name} />
                      <Metric label="투입" value={`${work.assignees.length}명`} />
                      <Metric label="시건 중" value={`${openLocks.length}`} />
                    </div>

                    <LotoList
                      rows={work.assignees.map((assignee) => {
                        const lock = work.locks.find((l) => l.userId === assignee.userId);
                        return {
                          userId: assignee.userId,
                          name: assignee.user.name,
                          employeeNumber: assignee.user.employeeNumber,
                          lockedAt: lock?.lockedAt ?? null,
                          releasedAt: lock?.releasedAt ?? null,
                          isMe: assignee.userId === user.id,
                        };
                      })}
                    />

                    <LotoButtons
                      workId={work.id}
                      locked={myLock != null && myLock.releasedAt === null}
                    />
                    <p className="text-[12px] leading-5 text-ink-3">
                      개인 시건은 본인만 걸고 본인만 풉니다. 안전관리자도 대신 해제할 수 없습니다.
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/*
          자기 조 점수는 보기만 한다. 점수를 매기는 건 안전관리자의 판정이고, 여기서
          할 수 있는 일은 없다 — 손댈 수 없는 화면에 버튼을 두면 눌러 보게 된다.
        */}
        <section id="score" className="flex flex-col gap-3">
          <SectionHead
            title="내 조 안전 점수"
            action={<span className="text-[12px] text-ink-3">오늘 부과 기준 · 보기 전용</span>}
          />
          {!user.team ? (
            <Empty>배정된 작업조가 없습니다. 안전관리자가 조를 배정하면 점수가 보입니다.</Empty>
          ) : (
            <div className="paper flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-[14.5px] font-bold">{user.team.name}</h3>
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{user.team.workArea}</p>
                </div>
                <span className="tag shrink-0" style={{ color: myTone, borderColor: myTone }}>
                  {scoreLabel(myScore)}
                </span>
              </div>

              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="eyebrow">오늘 부과 기준 조 점수</p>
                  <p className="mt-1 text-[12px] text-ink-3">
                    오늘 부과 <span className="num">{myPenalties.length}</span>건 · 감점{" "}
                    <span className="num">{myPenalty}</span>점
                  </p>
                </div>
                <p className="sign shrink-0 text-[2.75rem] leading-none" style={{ color: myTone }}>
                  {myScore}
                  <span className="ml-1 text-[0.875rem] font-medium text-ink-3">/100</span>
                </p>
              </div>

              <div
                role="progressbar"
                aria-label={`${user.team.name} 오늘 부과 기준 조 점수`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={myScore}
                className="h-1.5 overflow-hidden rounded-[1px] bg-rule-soft"
              >
                <div className="h-full" style={{ width: `${myScore}%`, background: myTone }} />
              </div>

              <p className="text-[12px] leading-5 text-ink-3">
                안전관리자가 위험으로 확정한 사건만 점수에 들어갑니다. 첫 건은{" "}
                <span className="num">{CONFIRMED_EVENT_PENALTY}</span>점이고, 같은 조가 오늘
                되풀이하면 건마다 2배가 되어 최대{" "}
                <span className="num">{MAX_EVENT_PENALTY}</span>점까지 깎입니다. 점수는 날마다
                <span className="num"> 100</span>점에서 다시 시작합니다.
              </p>
            </div>
          )}
        </section>

        <section id="alerts" className="flex flex-col gap-3">
          <SectionHead title="오늘의 안전 알림" count={`${alerts.length}건`} />
          {alerts.length === 0 ? (
            <Empty>오늘 위험구역에서 감지된 사건이 없습니다.</Empty>
          ) : (
            <ul className="ruled paper">
              {alerts.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                  <LevelTag level={event.level} />
                  <span className="text-[13.5px] font-bold">{riskCodeLabel(event.code)}</span>
                  <span className="text-[13px] text-ink-2">
                    <span className="num">{event.equipment.code}</span>{" "}
                    {event.zone?.name ?? event.equipment.name}
                  </span>
                  <span className="num text-[12.5px] text-ink-3">
                    {formatStamp(event.detectedAt)} · 잔류 {formatDurationKo(event.dwellSec)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] leading-5 text-ink-3">
            사람은 익명 추적 번호로만 기록됩니다. 얼굴 인식이나 개인 식별은 하지 않으며, 저장되는
            사진의 머리 부분은 흐리게 처리됩니다.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
