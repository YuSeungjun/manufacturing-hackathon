import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EvidenceView } from "@/components/EvidenceView";
import { PageHead, Empty, LevelTag, StatusTag, JudgmentStamp, Metric } from "@/components/ui";
import {
  MACHINE_STATE_LABEL,
  RISK_STATUS_LABEL,
  parseBoxes,
  parsePolygon,
  parseTrackIds,
  riskCodeLabel,
} from "@/lib/zone";
import { formatClock, formatDurationKo, formatStamp } from "@/lib/date";
import { ReviewForm } from "./ReviewForm";

const TABS = ["PENDING", "CONFIRMED", "FALSE_POSITIVE", "HOLD", "ALL"] as const;
const TAB_LABEL: Record<string, string> = { ...RISK_STATUS_LABEL, ALL: "전체" };

/** 확정 전 캡처는 AI 서비스에만 있고 휘발성이다. 브라우저가 헤더를 못 붙이니 프록시를 태운다. */
function captureSrc(path: string) {
  if (!path) return "";
  return path.startsWith("/captures/") ? `/api/ai${path}` : path;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const manager = await requireManager();
  const { status: raw } = await searchParams;
  const status = TABS.includes(raw as (typeof TABS)[number]) ? raw! : "PENDING";

  const events = await prisma.riskEvent.findMany({
    where: {
      workplaceId: manager.workplaceId,
      ...(status === "ALL" ? {} : { status }),
    },
    orderBy: [{ detectedAt: "desc" }],
    take: 30,
    include: {
      zone: true,
      camera: true,
      equipment: { select: { code: true, name: true, interlock: true } },
      review: { include: { reviewedBy: { select: { name: true } } } },
      analysis: { select: { id: true } },
    },
  });

  const counts = await prisma.riskEvent.groupBy({
    by: ["status"],
    where: { workplaceId: manager.workplaceId },
    _count: true,
  });
  const countOf = (key: string) =>
    key === "ALL"
      ? counts.reduce((sum, c) => sum + c._count, 0)
      : (counts.find((c) => c.status === key)?._count ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        stage={3}
        title="위험 사건"
        sub="AI 가 만든 것은 의심이지 판정이 아닙니다. 근거를 보고 위험인지 오탐인지 사람이 정합니다. 확정한 건만 지표와 증빙에 남습니다."
      />

      <nav className="scroll-x flex gap-1.5" aria-label="상태 필터">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/manager/events?status=${tab}`}
            aria-current={status === tab ? "page" : undefined}
            className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] font-bold transition-colors ${
              status === tab ? "bg-act-soft text-act" : "text-ink-3 hover:bg-paper-2 hover:text-ink"
            }`}
          >
            {TAB_LABEL[tab]} <span className="num">{countOf(tab)}</span>
          </Link>
        ))}
      </nav>

      {events.length === 0 ? (
        <Empty>
          {status === "PENDING"
            ? "검토를 기다리는 위험 사건이 없습니다."
            : "해당하는 사건이 없습니다."}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-5">
          {events.map((event) => {
            const evidence = captureSrc(event.evidencePath);
            const clip = captureSrc(event.clipPath);
            const tracks = parseTrackIds(event.trackIds);
            return (
              <li
                key={event.id}
                className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
              >
                {/* 왼쪽 — 기계 층. AI 가 본 것 */}
                <div className="flex flex-col gap-2">
                  {evidence ? (
                    <EvidenceView
                      src={evidence}
                      boxes={parseBoxes(event.boxes)}
                      polygon={parsePolygon(event.zonePolygon)}
                      zoneName={event.zone?.name}
                      occupancy={event.occupantsAtPeak}
                      dwellSec={event.dwellSec}
                      camera={event.camera?.code}
                      stamp={event.detectedAt}
                    />
                  ) : (
                    <Empty>근거 이미지가 없습니다.</Empty>
                  )}

                  {clip ? (
                    <figure className="plate overflow-hidden">
                      <figcaption className="scan px-2 py-1.5">전후 {formatDurationKo(5)} 클립</figcaption>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={clip} alt="위험 순간 전후 클립" className="block w-full" />
                    </figure>
                  ) : null}
                </div>

                {/* 오른쪽 — 사람 층. 사람이 정하는 것 */}
                <div className="paper flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <LevelTag level={event.level} />
                    <h3 className="text-[15px] font-bold">{riskCodeLabel(event.code)}</h3>
                    <span className="ml-auto flex items-center gap-2">
                      <StatusTag status={event.status} />
                      {event.review ? <JudgmentStamp decision={event.review.decision} /> : null}
                    </span>
                  </div>

                  <p className="text-[13.5px] leading-6 text-ink-2">{event.reason}</p>

                  <dl className="field text-[13px]">
                    <dt>설비</dt>
                    <dd>
                      <span className="num">{event.equipment.code}</span> {event.equipment.name}
                      {event.equipment.interlock === "BLOCKED" ? (
                        <span className="ml-2 tag tag-deny">재가동 차단 중</span>
                      ) : null}
                    </dd>
                    <dt>구역</dt>
                    <dd>{event.zone?.name ?? "구역 미지정"}</dd>
                    <dt>감지</dt>
                    <dd className="num">{formatStamp(event.detectedAt)}</dd>
                    <dt>노출</dt>
                    <dd className="num">
                      {formatDurationKo(event.dwellSec)}
                      {event.clipStartSec != null && event.clipEndSec != null
                        ? ` · 영상 ${formatClock(event.clipStartSec)}–${formatClock(event.clipEndSec)}`
                        : ""}
                    </dd>
                    <dt>설비 상태</dt>
                    <dd>{MACHINE_STATE_LABEL[event.machineState] ?? event.machineState}</dd>
                    <dt>출처</dt>
                    <dd>
                      {event.source === "MANUAL" ? "안전관리자 직접 등록 (AI 미탐)" : "AI 탐지"}
                      <span className="num ml-2 text-ink-3">{event.modelRepo}</span>
                    </dd>
                  </dl>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <Metric label="인원" value={`${event.occupantsAtPeak}`} />
                    <Metric
                      label="추적 번호"
                      value={tracks.length > 0 ? tracks.map((t) => `#${t}`).join(" ") : "—"}
                    />
                    {event.analysis ? (
                      <Link
                        href={`/manager/analysis/${event.analysis.id}`}
                        className="ml-auto btn-quiet btn-sm"
                      >
                        타임라인에서 보기
                      </Link>
                    ) : null}
                  </div>
                  <p className="text-[11.5px] leading-5 text-ink-3">
                    추적 번호는 이 영상 안에서만 쓰이는 익명 번호입니다. 얼굴 인식이나 개인 식별은
                    하지 않습니다.
                  </p>

                  {event.review ? (
                    <p className="text-[12.5px] text-ink-3">
                      {event.review.reviewedBy.name} · {formatStamp(event.review.reviewedAt)}
                      {event.review.comment ? ` — ${event.review.comment}` : ""}
                    </p>
                  ) : null}

                  <ReviewForm
                    riskEventId={event.id}
                    status={event.status}
                    comment={event.review?.comment ?? ""}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
