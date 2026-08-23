import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHead, SectionHead, Empty, LevelTag, StatusTag, InterlockBadge, Metric } from "@/components/ui";
import { riskCodeLabel } from "@/lib/zone";
import { formatDurationKo, formatStamp } from "@/lib/date";
import { ApprovalForm } from "./ApprovalForm";

export default async function RestartsPage() {
  const manager = await requireManager();

  const [open, history] = await Promise.all([
    prisma.restartRequest.findMany({
      where: {
        workplaceId: manager.workplaceId,
        decision: "BLOCKED",
        outcome: "OPEN",
        approvedAt: null,
      },
      orderBy: { requestedAt: "asc" },
      include: {
        equipment: true,
        requestedBy: { select: { name: true, employeeNumber: true } },
        blockedBy: { include: { zone: true } },
      },
    }),
    prisma.restartRequest.findMany({
      where: { workplaceId: manager.workplaceId, NOT: { outcome: "OPEN", approvedAt: null } },
      orderBy: { requestedAt: "desc" },
      take: 12,
      include: {
        equipment: { select: { code: true, name: true } },
        requestedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    }),
  ]);

  // 개인 시건은 관리자도 대신 못 푼다. 승인 버튼을 누르기 전에 미리 알려 준다.
  const lockCounts = new Map<string, number>();
  for (const request of open) {
    if (lockCounts.has(request.equipmentId)) continue;
    lockCounts.set(
      request.equipmentId,
      await prisma.lotoLock.count({
        where: {
          releasedAt: null,
          work: { equipmentId: request.equipmentId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        },
      }),
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        stage={4}
        title="재가동 승인"
        sub="AI 가 막은 재가동은 사람이 현장을 확인한 뒤에만 풀립니다. 이 화면이 이 시스템과 '알림만 보내는 CCTV' 를 가르는 자리입니다."
      />

      <section className="flex flex-col gap-3">
        <SectionHead title="해제를 기다리는 요청" count={`${open.length}건`} />
        {open.length === 0 ? (
          <Empty>차단된 재가동 요청이 없습니다. 모든 설비가 정상 상태입니다.</Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {open.map((request) => {
              const openLocks = lockCounts.get(request.equipmentId) ?? 0;
              const risk = request.blockedBy;
              const undecided = risk?.status === "PENDING";
              return (
                <li key={request.id} className="paper flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-[12.5px] font-bold text-ink-3">
                      {request.equipment.code}
                    </span>
                    <h3 className="text-[15px] font-bold">{request.equipment.name}</h3>
                    <InterlockBadge interlock={request.equipment.interlock} />
                    <span className="ml-auto num text-[12.5px] text-ink-3">
                      {formatStamp(request.requestedAt)}
                    </span>
                  </div>

                  <p className="text-[13.5px] leading-6" style={{ color: "var(--deny)" }}>
                    {request.blockReason}
                  </p>

                  <dl className="field text-[13px]">
                    <dt>요청자</dt>
                    <dd>
                      {request.requestedBy.name}{" "}
                      <span className="num text-ink-3">{request.requestedBy.employeeNumber}</span>
                    </dd>
                    {request.reason ? (
                      <>
                        <dt>요청 사유</dt>
                        <dd>{request.reason}</dd>
                      </>
                    ) : null}
                    {risk ? (
                      <>
                        <dt>차단 근거</dt>
                        <dd className="flex flex-wrap items-center gap-2">
                          <LevelTag level={risk.level} />
                          {riskCodeLabel(risk.code)}
                          {risk.zone ? ` · ${risk.zone.name}` : ""}
                          <StatusTag status={risk.status} />
                        </dd>
                      </>
                    ) : null}
                  </dl>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <Metric label="구역 인원" value={`${request.occupancyAtRequest}`} />
                    <Metric label="미해제 시건" value={`${openLocks}`} />
                    {risk ? (
                      <Metric label="잔류" value={formatDurationKo(risk.dwellSec)} />
                    ) : null}
                    <Link href="/manager/events" className="ml-auto btn-quiet btn-sm">
                      사건 검토로
                    </Link>
                  </div>

                  {undecided ? (
                    <p className="text-[13px] font-bold" style={{ color: "var(--hold)" }}>
                      먼저 위험 사건을 확정 또는 오탐으로 판단해야 해제할 수 있습니다.
                    </p>
                  ) : null}
                  {openLocks > 0 ? (
                    <p className="text-[13px] font-bold" style={{ color: "var(--hold)" }}>
                      개인 시건 {openLocks}건이 남아 있습니다. 작업자 본인이 해제해야 하며,
                      안전관리자도 대신 풀 수 없습니다.
                    </p>
                  ) : null}

                  <ApprovalForm
                    requestId={request.id}
                    blocked={undecided || openLocks > 0}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="지난 요청" count={`${history.length}건`} />
        {history.length === 0 ? (
          <Empty>아직 처리된 재가동 요청이 없습니다.</Empty>
        ) : (
          <ul className="ruled paper">
            {history.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
                <span className="num text-[12.5px] text-ink-3">{request.equipment.code}</span>
                <span className="text-[13.5px]">{request.equipment.name}</span>
                <span
                  className={`tag ${request.decision === "BLOCKED" ? "tag-deny" : "tag-safe"}`}
                >
                  {request.decision === "BLOCKED" ? "차단됨" : "즉시 허용"}
                </span>
                {request.outcome === "RESTARTED" ? (
                  <span className="tag tag-safe">재가동 완료</span>
                ) : request.outcome === "REJECTED" ? (
                  <span className="tag tag-hold">반려</span>
                ) : request.approvedAt ? (
                  <span className="tag tag-act">해제 승인</span>
                ) : null}
                <span className="num text-[12.5px] text-ink-3">
                  {formatStamp(request.requestedAt)}
                </span>
                <span className="text-[12.5px] text-ink-3">
                  {request.requestedBy.name} 요청
                  {request.approvedBy ? ` · ${request.approvedBy.name} 승인` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
