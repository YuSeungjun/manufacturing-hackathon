import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHead, SectionHead, Empty, InterlockBadge, Metric } from "@/components/ui";
import { LotoList } from "@/components/LotoList";
import { formatIsoDateKo, toLocalIsoDate } from "@/lib/date";
import { WorkForm } from "./WorkForm";

export default async function WorksPage() {
  const manager = await requireManager();

  const [works, equipment, teams] = await Promise.all([
    prisma.maintenanceWork.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      take: 20,
      include: {
        equipment: true,
        team: true,
        assignees: { include: { user: { select: { id: true, name: true, employeeNumber: true } } } },
        locks: true,
      },
    }),
    prisma.equipment.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: [{ line: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    prisma.team.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: { name: "asc" },
      include: {
        users: {
          where: { role: "WORKER", approvalStatus: "APPROVED" },
          orderBy: { employeeNumber: "asc" },
          select: { id: true, name: true, employeeNumber: true },
        },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="정비 작업 (LOTO)"
        sub="정비 작업을 열면 설비는 정비 상태로 들어가고 재가동이 잠깁니다. 기존 LOTO 절차를 대체하지 않고, AI 판정과 함께 인터록의 두 번째 근거로 씁니다."
      />

      <section className="flex flex-col gap-3">
        <SectionHead title="새 정비 작업" />
        <WorkForm
          equipment={equipment}
          teams={teams.map((t) => ({ id: t.id, name: t.name, workArea: t.workArea, members: t.users }))}
          today={toLocalIsoDate(new Date())}
        />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="작업 목록" count={`${works.length}건`} />
        {works.length === 0 ? (
          <Empty>아직 등록된 정비 작업이 없습니다.</Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {works.map((work) => {
              const openLocks = work.locks.filter((l) => l.releasedAt === null);
              return (
                <li key={work.id} className="paper flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-[12.5px] font-bold text-ink-3">
                      {work.equipment.code}
                    </span>
                    <h3 className="text-[15px] font-bold">{work.title}</h3>
                    <span
                      className={`tag ${work.status === "COMPLETED" ? "tag-safe" : "tag-act"}`}
                    >
                      {work.status === "COMPLETED" ? "완료" : "진행 중"}
                    </span>
                    <InterlockBadge
                      interlock={work.equipment.interlock}
                      reason={work.equipment.interlockReason}
                    />
                    <span className="ml-auto num text-[12.5px] text-ink-3">
                      {formatIsoDateKo(toLocalIsoDate(work.workDate))}
                    </span>
                  </div>

                  {work.summary ? (
                    <p className="text-[13.5px] leading-6 text-ink-2">{work.summary}</p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <Metric label="작업조" value={work.team.name} />
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
                      };
                    })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
