import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Empty, Metric, PageHead, SectionHead } from "@/components/ui";
import { CreateTeamForm, TeamMemberForm, WorkAssigneeForm } from "./TeamSettingsForms";

export default async function TeamsPage() {
  const manager = await requireManager();
  const [teams, workers] = await Promise.all([
    prisma.team.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: { name: "asc" },
      include: {
        users: {
          where: { role: "WORKER", approvalStatus: "APPROVED" },
          orderBy: { employeeNumber: "asc" },
          select: { id: true, name: true, employeeNumber: true },
        },
        works: {
          where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
          orderBy: { createdAt: "desc" },
          include: {
            equipment: { select: { code: true, name: true } },
            assignees: { select: { userId: true } },
            locks: { where: { releasedAt: null }, select: { userId: true } },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        workplaceId: manager.workplaceId,
        role: "WORKER",
        approvalStatus: "APPROVED",
      },
      orderBy: { employeeNumber: "asc" },
      select: {
        id: true,
        name: true,
        employeeNumber: true,
        teamId: true,
        team: { select: { name: true } },
      },
    }),
  ]);

  const workerOptions = workers.map((worker) => ({
    id: worker.id,
    name: worker.name,
    employeeNumber: worker.employeeNumber,
    teamId: worker.teamId,
    teamName: worker.team?.name ?? null,
  }));
  const unassigned = workers.filter((worker) => worker.teamId === null);

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        stage={1}
        title="조 설정"
        sub="작업자를 작업조에 편성하고, 진행 중인 정비 작업에 실제 투입할 사람을 지정합니다. 개인 시건을 건 작업자는 작업이 끝날 때까지 투입 명단에서 제외할 수 없습니다."
        action={
          <Link href="/manager/works" className="btn-act btn-sm">
            새 정비 작업
          </Link>
        }
      />

      {unassigned.length > 0 ? (
        <p className="rounded-md border border-rule bg-paper-2 px-4 py-3 text-[13px] text-ink-2">
          아직 조가 없는 작업자 <strong className="font-bold">{unassigned.length}명</strong>: {" "}
          {unassigned.map((worker) => worker.name).join(", ")}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHead title="작업조" count={`${teams.length}개 조`} />
        {teams.length === 0 ? (
          <Empty>등록된 작업조가 없습니다. 아래에서 첫 작업조를 만들어 주세요.</Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {teams.map((team) => (
              <li key={team.id} className="paper flex flex-col gap-4 p-4">
                <div className="flex flex-wrap items-center gap-3 border-b border-rule pb-3">
                  <div>
                    <h2 className="text-[15px] font-bold">{team.name}</h2>
                    <p className="text-[12.5px] text-ink-3">{team.workArea}</p>
                  </div>
                  <span className="ml-auto flex flex-wrap gap-3">
                    <Metric label="조원" value={`${team.users.length}명`} />
                    <Metric label="진행 작업" value={`${team.works.length}건`} />
                  </span>
                </div>

                <TeamMemberForm
                  key={`${team.id}:${team.users.map((user) => user.id).join(",")}`}
                  teamId={team.id}
                  workers={workerOptions}
                />

                <div className="flex flex-col gap-3 border-t border-rule pt-3">
                  <div>
                    <p className="label">작업별 투입자</p>
                    <p className="text-[12.5px] text-ink-3">
                      조원 중 해당 설비 작업에 실제로 들어가는 사람만 선택합니다.
                    </p>
                  </div>
                  {team.works.length === 0 ? (
                    <p className="text-[13px] text-ink-3">이 조에서 진행 중인 정비 작업이 없습니다.</p>
                  ) : (
                    team.works.map((work) => {
                      const assignedIds = work.assignees.map((assignee) => assignee.userId);
                      const lockedIds = work.locks.map((lock) => lock.userId);
                      return (
                        <div key={work.id} className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="num text-[12px] font-bold text-ink-3">
                              {work.equipment.code}
                            </span>
                            <h3 className="text-[13.5px] font-bold">{work.title}</h3>
                            <span className="text-[12px] text-ink-3">{work.equipment.name}</span>
                          </div>
                          <WorkAssigneeForm
                            key={`${work.id}:${assignedIds.join(",")}`}
                            workId={work.id}
                            members={team.users}
                            assignedIds={assignedIds}
                            lockedIds={lockedIds}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="새 작업조" />
        <CreateTeamForm />
      </section>
    </div>
  );
}
