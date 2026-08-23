import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { managerFlow } from "@/lib/flow";
import { safetyMetrics } from "@/lib/metrics";
import { TeamScoreBoard, type TeamScoreRow } from "@/components/TeamScoreBoard";
import { PageHead, SectionHead, Empty, LevelTag, StatusTag, Metric } from "@/components/ui";
import { AlertPoller } from "@/components/AlertPoller";
import { CctvSimulationPopup } from "@/components/CctvSimulationPopup";
import { dayRange, formatDurationKo, formatStamp, lastIsoDays, todayLocalISO } from "@/lib/date";
import { riskCodeLabel } from "@/lib/zone";
import { teamScoreFromPenalty } from "@/lib/score";
import { decideManagerApprovalAction } from "@/app/actions/admin";

export default async function ManagerHome() {
  const manager = await requireManager();
  const today = todayLocalISO();
  const { from, to } = dayRange(today);
  const week = lastIsoDays(today, 7);
  const weekStart = dayRange(week[0]).from;
  const [flow, weekEvents, chargedToday, recent, pendingUsers, metrics, teams] = await Promise.all([
    managerFlow(manager.workplaceId),
    prisma.riskEvent.findMany({
      where: { workplaceId: manager.workplaceId, enteredAt: { gte: weekStart, lt: to } },
      select: {
        equipmentId: true,
        enteredAt: true,
        clearedAt: true,
        dwellSec: true,
        status: true,
        chargedTeamId: true,
        penaltyPoints: true,
      },
    }),
    // 점수는 "오늘 부과한 벌점" 기준이다. 사건 발생일로 세면 어제 사건을 오늘 부과했을 때
    // 어디에도 나타나지 않는다 — 이 화면에는 날짜 이동이 없다.
    prisma.riskEvent.findMany({
      where: {
        workplaceId: manager.workplaceId,
        status: "CONFIRMED",
        resolvedAt: { gte: from, lt: to },
      },
      select: { chargedTeamId: true, penaltyPoints: true },
    }),
    prisma.riskEvent.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: { detectedAt: "desc" },
      take: 6,
      include: { zone: true, equipment: { select: { code: true, name: true } } },
    }),
    prisma.user.findMany({
      where: { workplaceId: manager.workplaceId, approvalStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
    }),
    safetyMetrics(manager.workplaceId, from, to),
    prisma.team.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { users: true } },
        works: {
          where: { workDate: { gte: from, lt: to } },
          select: {
            equipmentId: true,
            status: true,
            locks: { select: { releasedAt: true } },
          },
        },
      },
    }),
  ]);

  const todayEvents = weekEvents.filter((event) => event.enteredAt >= from && event.enteredAt < to);
  const teamRows: TeamScoreRow[] = teams.map((team) => {
    /**
     * 벌점은 **부과된 조** 것만 센다.
     *
     * 전에는 팀 → 정비작업 → 설비 → 그 설비의 사건으로 추론했다. 그러면 한 설비에 두 조가
     * 붙으면 둘 다 깎이고, 정비 작업을 등록하지 않은 조는 사건이 나도 안 깎인다.
     * 지금은 진행 중인 사건을 종결할 때 사람이 지목한 조에만 반영된다.
     *
     * 날짜는 **부과한 날** 기준이다. 사건 발생일로 세면 날을 넘겨 부과한 벌점이
     * 현황판 어디에도 안 보인다.
     */
    /*
     * 건수가 아니라 **부과된 벌점의 합**으로 센다. 되풀이는 배로 매기므로(10→20→40→80)
     * 건수 × 10 으로 되돌리면 20 점을 물린 건이 점수판에서 10 점으로 줄어든다.
     */
    const chargedRows = chargedToday.filter((event) => event.chargedTeamId === team.id);
    const confirmedEvents = chargedRows.length;
    const { score, penalty } = teamScoreFromPenalty(
      chargedRows.reduce((sum, event) => sum + event.penaltyPoints, 0),
    );

    // 검토 대기는 아직 조가 정해지지 않았다(부과 시점에 고른다). 그 조가 맡은 설비의
    // 사건 수를 참고값으로 보여준다 — 점수에는 들어가지 않는다.
    const equipmentIds = new Set(team.works.map((work) => work.equipmentId));

    return {
      id: team.id,
      name: team.name,
      workArea: team.workArea,
      score,
      penalty,
      memberCount: team._count.users,
      workCount: team.works.length,
      pendingEvents: todayEvents.filter(
        (event) => event.status === "PENDING" && equipmentIds.has(event.equipmentId),
      ).length,
      confirmedEvents,
      openLocks: team.works.reduce(
        (sum, work) => sum + work.locks.filter((lock) => lock.releasedAt === null).length,
        0,
      ),
    };
  });
  teamRows.sort((a, b) => a.score - b.score || b.pendingEvents - a.pendingEvents || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-7">
      <AlertPoller />
      <CctvSimulationPopup />

      <PageHead
        title="현황판"
        sub={`${manager.workplace.name} · 이송·회전설비 재가동 인터록`}
        action={
          <span className="flex gap-2">
            <Link href="/manager/works" className="btn-quiet btn-sm">
              정비 작업
            </Link>
            <Link href="/manager/patterns" className="btn-quiet btn-sm">
              반복 패턴
            </Link>
            <Link href="/manager/metrics" className="btn-quiet btn-sm">
              도입 효과 지표
            </Link>
          </span>
        }
      />

      {flow.next ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md px-4 py-3.5"
          style={{ border: "2px solid var(--act)", background: "var(--act-soft)" }}
        >
          <p className="text-[14px] font-bold">{flow.next.label}</p>
          <Link href={flow.next.href} className="btn-act btn-sm">
            {flow.next.cta}
          </Link>
        </div>
      ) : (
        <p className="rounded-md border border-rule px-4 py-3.5 text-[13.5px] text-ink-2">
          지금 처리할 일이 없습니다. 모든 설비의 인터록이 해제되어 있고 검토 대기 사건도 없습니다.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <SectionHead title="오늘" />
        <div className="paper flex flex-wrap gap-x-6 gap-y-3 p-4">
          <Metric label="차단한 재가동" value={metrics.blocked.requests} />
          <Metric label="자동 인터록" value={metrics.blocked.autoInterlocks} />
          <Metric label="위험구역 노출" value={formatDurationKo(metrics.exposure.totalSec)} />
          <Metric
            label="감지 소요"
            value={metrics.detectLatency.avgSec != null ? formatDurationKo(metrics.detectLatency.avgSec) : "—"}
          />
          <Metric
            label="조치 소요"
            value={metrics.response.ackSec != null ? formatDurationKo(metrics.response.ackSec) : "—"}
          />
          <Metric label="검토 대기" value={flow.pendingEvents} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead
          title="작업조 안전 점수"
          count={`${teamRows.length}개 조`}
          action={
            <span className="text-[12px] text-ink-3">확정 1건 10점 · 같은 조가 되풀이하면 2배(최대 80점)</span>
          }
        />
        {teamRows.length === 0 ? (
          <Empty>등록된 작업조가 없습니다.</Empty>
        ) : (
          <TeamScoreBoard rows={teamRows} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead
          title="최근 위험 사건"
          action={
            <Link href="/manager/incidents" className="text-[13px] font-bold text-act">
              전체 보기
            </Link>
          }
        />
        {recent.length === 0 ? (
          <Empty>아직 감지된 위험 사건이 없습니다.</Empty>
        ) : (
          <ul className="ruled paper">
            {recent.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                <LevelTag level={event.level} />
                <span className="text-[13.5px] font-bold">{riskCodeLabel(event.code)}</span>
                <span className="text-[13px] text-ink-2">
                  <span className="num">{event.equipment.code}</span>{" "}
                  {event.zone?.name ?? event.equipment.name}
                </span>
                <span className="num text-[12.5px] text-ink-3">{formatStamp(event.detectedAt)}</span>
                <span className="ml-auto">
                  <StatusTag status={event.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pendingUsers.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHead title="가입 승인 대기" count={`${pendingUsers.length}명`} />
          <ul className="ruled paper">
            {pendingUsers.map((user) => (
              <li key={user.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span className="text-[13.5px] font-bold">{user.name}</span>
                <span className="num text-[12.5px] text-ink-3">{user.employeeNumber}</span>
                <form action={decideManagerApprovalAction} className="ml-auto flex gap-2">
                  <input type="hidden" name="userId" value={user.id} />
                  <button type="submit" name="decision" value="APPROVED" className="btn-act btn-sm">
                    승인
                  </button>
                  <button type="submit" name="decision" value="REJECTED" className="btn-quiet btn-sm">
                    반려
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
