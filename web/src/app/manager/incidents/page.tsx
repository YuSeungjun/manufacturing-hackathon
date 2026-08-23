import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  PageHead,
  SectionHead,
  Empty,
  LevelTag,
  StatusTag,
  JudgmentStamp,
} from "@/components/ui";
import { EvidenceView } from "@/components/EvidenceView";
import {
  RISK_STATUS_LABEL,
  parseBoxes,
  parsePolygon,
  riskCodeLabel,
} from "@/lib/zone";
import { dayRange, formatDurationKo, formatStamp, todayLocalISO } from "@/lib/date";
import { ReviewForm } from "@/components/ReviewForm";
import { ResolveForm, type TeamChoice } from "./ResolveForm";

/** 진행 중이 기본. 종결한 것도 볼 수 있게 탭을 둔다. */
// 오탐·보류도 여기서 본다. 판정 화면을 따로 두지 않고 사건의 종착지를 한 곳에 모은다.
const TABS = ["IN_PROGRESS", "CONFIRMED", "PASSED", "FALSE_POSITIVE", "HOLD", "LOGGED"] as const;
/** 종결된 것과 판정만 된 것은 빈 화면 문구가 달라야 한다. */
const RESOLVED = new Set(["CONFIRMED", "PASSED"]);

/** 확정 전 캡처는 AI 서비스에만 있고 휘발성이다. 브라우저가 헤더를 못 붙이니 프록시를 태운다. */
function captureSrc(path: string) {
  if (!path) return "";
  return path.startsWith("/captures/") ? `/api/ai${path}` : path;
}

/**
 * 근거 이미지 주소. 사건이 가리키는 캡처가 먼저고, 없으면 그 분석이 본 그림으로 간다.
 *
 * 정지 이미지 분석은 사건 캡처를 따로 만들지 않는다 — 근거가 입력 프레임 그 자체다.
 * 저장할 때 그 프레임을 채우도록 고쳤지만, 그 전에 쌓인 사건은 비어 있다. 근거가 없는
 * 게 아니라 가리키지 않은 것뿐이라 여기서 되돌린다.
 */
function evidenceSrc(event: {
  evidencePath: string;
  analysis: { posterPath: string; frameUrls: string } | null;
}) {
  const direct = captureSrc(event.evidencePath);
  if (direct) return direct;
  const analysis = event.analysis;
  if (!analysis) return "";
  try {
    const frames = JSON.parse(analysis.frameUrls || "[]");
    if (Array.isArray(frames) && typeof frames[0] === "string" && frames[0]) return frames[0];
  } catch {
    // 프레임 목록이 깨졌으면 대표 그림으로 간다.
  }
  return analysis.posterPath ?? "";
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const manager = await requireManager();
  const { status: raw } = await searchParams;
  const status = TABS.includes(raw as (typeof TABS)[number]) ? raw! : "IN_PROGRESS";
  const today = dayRange(todayLocalISO());

  const [events, counts, teams, chargedToday] = await Promise.all([
    prisma.riskEvent.findMany({
      where: { workplaceId: manager.workplaceId, status },
      // 진행 중은 오래된 것이 위로 온다 — 먼저 들어온 사건이 먼저 처리돼야 한다.
      orderBy: [{ startedAt: status === "IN_PROGRESS" ? "asc" : "desc" }],
      take: 30,
      include: {
        equipment: true,
        camera: true,
        zone: true,
        review: { include: { reviewedBy: { select: { name: true } } } },
        chargedTeam: { select: { name: true } },
        analysis: { select: { posterPath: true, frameUrls: true } },
      },
    }),
    prisma.riskEvent.groupBy({
      by: ["status"],
      where: { workplaceId: manager.workplaceId },
      _count: true,
    }),
    prisma.team.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: [{ workArea: "asc" }, { name: "asc" }],
      include: { _count: { select: { users: true } } },
    }),
    /*
     * 오늘 조별로 이미 부과한 확정 건수. 되풀이 벌점(10→20→40→80)이 여기서 정해진다.
     * 날짜는 **부과한 날**(resolvedAt) 기준이다 — 현황판 점수와 같은 기준이라야
     * 화면이 예고한 점수와 실제로 깎이는 점수가 어긋나지 않는다.
     */
    prisma.riskEvent.groupBy({
      by: ["chargedTeamId"],
      where: {
        workplaceId: manager.workplaceId,
        status: "CONFIRMED",
        resolvedAt: { gte: today.from, lt: today.to },
      },
      _count: true,
    }),
  ]);

  const chargedByTeam = new Map(
    chargedToday.map((row) => [row.chargedTeamId, row._count as number]),
  );
  const teamChoices: TeamChoice[] = teams.map((team) => ({
    id: team.id,
    name: team.name,
    workArea: team.workArea,
    memberCount: team._count.users,
    chargedToday: chargedByTeam.get(team.id) ?? 0,
  }));

  const countOf = (key: string) => counts.find((c) => c.status === key)?._count ?? 0;

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        stage={4}
        title="진행 중인 사건"
        sub="판정이 끝난 사건이 여기로 모입니다. 위험으로 확정된 건은 현장을 확인한 뒤 벌점 부과 또는 조치 완료로 종결하고, 오탐과 보류도 기록으로 남습니다."
        action={
          countOf("PENDING") > 0 ? (
            <Link href="/manager/analyze" className="btn-quiet btn-sm">
              검토 대기 {countOf("PENDING")}건
            </Link>
          ) : undefined
        }
      />

      <nav className="flex flex-wrap gap-1" aria-label="사건 상태">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={tab === "IN_PROGRESS" ? "/manager/incidents" : `/manager/incidents?status=${tab}`}
            aria-current={status === tab ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-[13px] font-bold transition-colors ${
              status === tab ? "bg-act-soft text-act" : "text-ink-3 hover:bg-paper-2 hover:text-ink"
            }`}
          >
            {RISK_STATUS_LABEL[tab]} <span className="num">{countOf(tab)}</span>
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-3">
        <SectionHead
          title={RISK_STATUS_LABEL[status]}
          count={`${events.length}건`}
          action={
            status === "IN_PROGRESS" && events.length > 0 ? (
              <span className="text-[12px] text-ink-3">오래된 사건이 위에 있습니다</span>
            ) : undefined
          }
        />

        {events.length === 0 ? (
          <Empty>
            {status === "IN_PROGRESS" ? (
              <>
                진행 중인 사건이 없습니다.{" "}
                <Link href="/manager/analyze" className="font-bold text-act underline">
                  영상 분석
                </Link>{" "}
                결과에서 «위험 확정»을 누르면 여기로 옮겨집니다.
              </>
            ) : RESOLVED.has(status) ? (
              `${RISK_STATUS_LABEL[status]}으로 종결한 사건이 없습니다.`
            ) : (
              `${RISK_STATUS_LABEL[status]}으로 판정한 사건이 없습니다.`
            )}
          </Empty>
        ) : (
          <ul className="flex flex-col gap-6">
            {events.map((event) => {
              const evidence = evidenceSrc(event);
              return (
                <li
                  key={event.id}
                  className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
                >
                  {/* 왼쪽 — 기계 층. AI 가 본 것 */}
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

                  {/* 오른쪽 — 사람 층. 사람이 정하는 것 */}
                  <div className="paper flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <LevelTag level={event.level} />
                      <h3 className="text-[15px] font-bold">{riskCodeLabel(event.code)}</h3>
                      <span className="ml-auto flex items-center gap-2">
                        <StatusTag status={event.status} />
                        {event.status !== "IN_PROGRESS" && event.review ? (
                          <JudgmentStamp decision={event.review.decision} />
                        ) : null}
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
                      <dd className="num">{formatDurationKo(event.dwellSec)}</dd>
                      {event.startedAt ? (
                        <>
                          <dt>진행 시작</dt>
                          <dd className="num">{formatStamp(event.startedAt)}</dd>
                        </>
                      ) : null}
                      {event.resolvedAt ? (
                        <>
                          <dt>종결</dt>
                          <dd className="num">{formatStamp(event.resolvedAt)}</dd>
                        </>
                      ) : null}
                      {event.chargedTeam ? (
                        <>
                          <dt>벌점</dt>
                          <dd>
                            {event.chargedTeam.name}
                            <span className="num ml-1.5 font-bold" style={{ color: "var(--deny)" }}>
                              −{event.penaltyPoints}점
                            </span>
                          </dd>
                        </>
                      ) : null}
                    </dl>

                    {event.review ? (
                      <p className="text-[12.5px] text-ink-3">
                        {event.review.reviewedBy.name} · {formatStamp(event.review.reviewedAt)}
                        {event.review.comment ? ` — ${event.review.comment}` : ""}
                      </p>
                    ) : null}

                    {event.status === "IN_PROGRESS" ? (
                      <ResolveForm riskEventId={event.id} teams={teamChoices} />
                    ) : event.status === "HOLD" ? (
                      // 보류를 눌러 둔 건은 다시 판정할 길이 있어야 한다.
                      <ReviewForm
                        riskEventId={event.id}
                        status={event.status}
                        comment={event.review?.comment ?? ""}
                        cleared={event.clearedAt != null}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
