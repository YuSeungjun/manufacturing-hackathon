import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { workerFlow } from "@/lib/flow";
import { AppShell } from "@/components/AppShell";
import { PageHead, SectionHead, Empty, LevelTag, InterlockBadge, Metric } from "@/components/ui";
import { LotoList } from "@/components/LotoList";
import { dayRange, formatDurationKo, formatStamp, todayLocalISO } from "@/lib/date";
import { riskCodeLabel } from "@/lib/zone";
import { LotoButtons } from "./LotoButtons";

export default async function WorkerPage() {
  const user = await requireUser();
  const flow = await workerFlow(user.workplaceId, user.id);
  const { from, to } = dayRange(todayLocalISO());

  const [works, alerts] = await Promise.all([
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
  ]);

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
