import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHead, Empty, LevelTag, Metric } from "@/components/ui";
import { riskCodeLabel } from "@/lib/zone";
import { formatDurationKo, formatStamp } from "@/lib/date";
import { ConfirmRestartButton } from "./ConfirmRestartButton";

export default async function OperatorRequestsPage() {
  const operator = await requireOperator();

  const requests = await prisma.restartRequest.findMany({
    where: { workplaceId: operator.workplaceId, requestedById: operator.id },
    orderBy: { requestedAt: "desc" },
    take: 30,
    include: {
      equipment: { select: { code: true, name: true, interlock: true } },
      approvedBy: { select: { name: true } },
      blockedBy: { include: { zone: true } },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        stage={2}
        title="내 재가동 요청"
        sub="차단된 요청은 안전관리자가 현장을 확인하고 해제해야 진행됩니다. 승인이 나면 여기서 바로 재가동할 수 있습니다."
      />

      {requests.length === 0 ? (
        <Empty>아직 재가동을 요청한 적이 없습니다.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => {
            const cleared = request.approvedAt != null;
            const restartable =
              request.decision === "BLOCKED" &&
              cleared &&
              request.outcome === "OPEN" &&
              request.equipment.interlock === "CLEAR";
            return (
              <li key={request.id} className="paper flex flex-col gap-2.5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-[12.5px] font-bold text-ink-3">
                    {request.equipment.code}
                  </span>
                  <h3 className="text-[14.5px] font-bold">{request.equipment.name}</h3>
                  <span className={`tag ${request.decision === "BLOCKED" ? "tag-deny" : "tag-safe"}`}>
                    {request.decision === "BLOCKED" ? "차단됨" : "즉시 허용"}
                  </span>
                  {request.outcome === "RESTARTED" ? (
                    <span className="tag tag-safe">재가동 완료</span>
                  ) : request.outcome === "REJECTED" ? (
                    <span className="tag tag-hold">반려</span>
                  ) : cleared ? (
                    <span className="tag tag-act">해제 승인됨</span>
                  ) : request.decision === "BLOCKED" ? (
                    <span className="tag tag-hold">승인 대기</span>
                  ) : null}
                  <span className="ml-auto num text-[12.5px] text-ink-3">
                    {formatStamp(request.requestedAt)}
                  </span>
                </div>

                {request.blockReason ? (
                  <p className="text-[13px] leading-6" style={{ color: "var(--deny)" }}>
                    {request.blockReason}
                  </p>
                ) : null}

                {request.blockedBy ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <LevelTag level={request.blockedBy.level} />
                    <span className="text-[13px]">{riskCodeLabel(request.blockedBy.code)}</span>
                    {request.blockedBy.zone ? (
                      <span className="text-[13px] text-ink-2">{request.blockedBy.zone.name}</span>
                    ) : null}
                    <Metric label="잔류" value={formatDurationKo(request.blockedBy.dwellSec)} />
                  </div>
                ) : null}

                {cleared ? (
                  <p className="text-[12.5px] text-ink-3">
                    {request.approvedBy?.name ?? "안전관리자"} 승인 ·{" "}
                    {formatStamp(request.approvedAt!)}
                    {request.approvalNote ? ` — ${request.approvalNote}` : ""}
                  </p>
                ) : null}

                {restartable ? (
                  <ConfirmRestartButton requestId={request.id} label={`${request.equipment.name} 재가동`} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
