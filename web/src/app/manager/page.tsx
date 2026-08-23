import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { managerFlow } from "@/lib/flow";
import { safetyMetrics } from "@/lib/metrics";
import { EquipmentBoard, type EquipmentRow } from "@/components/EquipmentBoard";
import { PageHead, SectionHead, Empty, LevelTag, StatusTag, Metric } from "@/components/ui";
import { AlertPoller } from "@/components/AlertPoller";
import { dayRange, formatDurationKo, formatStamp, lastIsoDays, todayLocalISO } from "@/lib/date";
import { riskCodeLabel } from "@/lib/zone";
import { decideManagerApprovalAction } from "@/app/actions/admin";

export default async function ManagerHome() {
  const manager = await requireManager();
  const today = todayLocalISO();
  const { from, to } = dayRange(today);
  const week = lastIsoDays(today, 7);
  const weekStart = dayRange(week[0]).from;

  const [flow, equipment, weekEvents, recent, pendingUsers, metrics] = await Promise.all([
    managerFlow(manager.workplaceId),
    prisma.equipment.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: [{ line: "asc" }, { code: "asc" }],
      include: {
        _count: { select: { zones: { where: { active: true } } } },
        works: {
          where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
          select: { locks: { where: { releasedAt: null }, select: { id: true } } },
        },
      },
    }),
    prisma.riskEvent.findMany({
      where: { workplaceId: manager.workplaceId, enteredAt: { gte: weekStart, lt: to } },
      select: { equipmentId: true, enteredAt: true, clearedAt: true, dwellSec: true, status: true },
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
  ]);

  const blockedByEquipment = await prisma.restartRequest.groupBy({
    by: ["equipmentId"],
    where: {
      workplaceId: manager.workplaceId,
      decision: "BLOCKED",
      outcome: "OPEN",
      approvedAt: null,
    },
    _count: true,
  });
  const blockedMap = new Map(blockedByEquipment.map((b) => [b.equipmentId, b._count]));

  function exposureOf(equipmentId: string, iso: string) {
    const { from: dayFrom, to: dayTo } = dayRange(iso);
    return weekEvents
      .filter((e) => e.equipmentId === equipmentId && e.enteredAt >= dayFrom && e.enteredAt < dayTo)
      .reduce(
        (sum, e) =>
          sum +
          (e.clearedAt ? Math.max(0, (e.clearedAt.getTime() - e.enteredAt.getTime()) / 1000) : e.dwellSec),
        0,
      );
  }

  const rows: EquipmentRow[] = equipment.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    line: item.line,
    runState: item.runState,
    interlock: item.interlock,
    interlockReason: item.interlockReason,
    zoneCount: item._count.zones,
    exposureSec: exposureOf(item.id, today),
    pendingEvents: weekEvents.filter(
      (e) => e.equipmentId === item.id && e.status === "PENDING" && e.enteredAt >= from,
    ).length,
    blockedRestarts: blockedMap.get(item.id) ?? 0,
    openLocks: item.works.reduce((sum, w) => sum + w.locks.length, 0),
    week: week.map((iso) => ({ iso, sec: exposureOf(item.id, iso) })),
  }));

  return (
    <div className="flex flex-col gap-7">
      <AlertPoller />

      <PageHead
        title="현황판"
        sub={`${manager.workplace.name} · 압연설비 재가동 인터록`}
        action={
          <span className="flex gap-2">
            <Link href="/manager/works" className="btn-quiet btn-sm">
              정비 작업
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
          style={{
            border: `2px solid ${flow.blockedRestarts > 0 ? "var(--deny)" : "var(--act)"}`,
            background: flow.blockedRestarts > 0 ? "var(--deny-soft)" : "var(--act-soft)",
          }}
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
        <SectionHead title="설비" count={`${rows.length}대`} />
        {rows.length === 0 ? (
          <Empty>
            등록된 설비가 없습니다.{" "}
            <Link href="/manager/equipment" className="font-bold text-act underline">
              첫 설비를 등록해 주세요.
            </Link>
          </Empty>
        ) : (
          <EquipmentBoard rows={rows} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead
          title="최근 위험 사건"
          action={
            <Link href="/manager/events?status=ALL" className="text-[13px] font-bold text-act">
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
