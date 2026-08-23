import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decideManagerApprovalAction } from "@/app/actions/admin";
import { DateNav } from "@/components/DateNav";
import { TeamBoard, type TeamRow } from "@/components/TeamBoard";
import { Empty, Metric, PageHead, SectionHead, StatusTag } from "@/components/ui";
import { dayRange, formatDate, formatIsoDateKo, formatTime, lastIsoDays, resolveDateParam, toLocalIsoDate, todayLocalISO } from "@/lib/date";
import { ppeLabel } from "@/lib/ppe";
import { managerFlow } from "@/lib/flow";
import { BASE_SCORE } from "@/lib/score";
import { aiHealth } from "@/lib/aiClient";

export default async function ManagerPage({ searchParams }: PageProps<"/manager">) {
  const manager = await requireManager();

  const today = todayLocalISO();
  const iso = resolveDateParam((await searchParams).date);
  const isToday = iso === today;
  const dayLabel = isToday ? "오늘" : formatIsoDateKo(iso);
  const { from, to } = dayRange(iso);
  const scope = { workplaceId: manager.workplaceId };

  const [tbms, detections, pendingUsers, teams, health] = await Promise.all([
    prisma.tbm.findMany({
      where: { ...scope, workDate: { gte: from, lt: to } },
      include: { team: true, acknowledgements: true, assignees: true, rules: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.detection.findMany({
      where: { tbm: scope, detectedAt: { gte: from, lt: to } },
      include: { tbm: { include: { team: true } }, safetyRule: true },
      orderBy: { detectedAt: "desc" },
    }),
    prisma.user.findMany({
      where: { ...scope, approvalStatus: "PENDING" },
      include: { team: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.team.findMany({ where: scope, orderBy: { name: "asc" } }),
    aiHealth(),
  ]);

  // 서명은 그 TBM 에 배정된 사람 것만 센다.
  const targetsOf = (tbm: (typeof tbms)[number]) => new Set(tbm.assignees.map((a) => a.userId));
  const signedOf = (tbm: (typeof tbms)[number]) => {
    const ids = targetsOf(tbm);
    return tbm.acknowledgements.filter((a) => ids.has(a.userId)).length;
  };

  const pendingDetections = detections.filter((d) => d.status === "PENDING");
  const confirmedDetections = detections.filter((d) => d.status === "CONFIRMED");

  // ── 최근 7일 ──
  const trendDays = lastIsoDays(iso, 7);
  const [trendTbms, trendConfirmed] = await Promise.all([
    prisma.tbm.findMany({
      where: { ...scope, workDate: { gte: dayRange(trendDays[0]).from, lt: to } },
      select: { teamId: true, workDate: true },
    }),
    prisma.detection.findMany({
      where: {
        tbm: scope,
        status: "CONFIRMED",
        detectedAt: { gte: dayRange(trendDays[0]).from, lt: to },
      },
      select: {
        detectedAt: true,
        tbm: { select: { teamId: true } },
        safetyRule: { select: { penalty: true } },
      },
    }),
  ]);

  const tbmDays = new Set(trendTbms.map((t) => `${t.teamId}|${toLocalIsoDate(t.workDate)}`));
  const byDay = new Map<string, { penalty: number; confirmed: number }>();
  for (const d of trendConfirmed) {
    const key = `${d.tbm.teamId}|${toLocalIsoDate(d.detectedAt)}`;
    const cur = byDay.get(key) ?? { penalty: 0, confirmed: 0 };
    cur.penalty += d.safetyRule?.penalty ?? 10;
    cur.confirmed += 1;
    byDay.set(key, cur);
  }

  const rows: TeamRow[] = teams.map((team) => {
    const teamTbms = tbms.filter((t) => t.teamId === team.id);
    const penalty = confirmedDetections
      .filter((d) => d.tbm.teamId === team.id)
      .reduce((sum, d) => sum + (d.safetyRule?.penalty ?? 10), 0);
    return {
      teamId: team.id,
      name: team.name,
      workArea: team.workArea,
      score: Math.max(0, BASE_SCORE - penalty),
      signed: teamTbms.reduce((sum, t) => sum + signedOf(t), 0),
      expected: teamTbms.reduce((sum, t) => sum + t.assignees.length, 0),
      pending: pendingDetections.filter((d) => d.tbm.teamId === team.id).length,
      confirmed: confirmedDetections.filter((d) => d.tbm.teamId === team.id).length,
      cells: trendDays.map((day) => {
        const hit = byDay.get(`${team.id}|${day}`);
        return {
          iso: day,
          hasTbm: tbmDays.has(`${team.id}|${day}`),
          penalty: hit?.penalty ?? 0,
          confirmed: hit?.confirmed ?? 0,
        };
      }),
    };
  });

  // 손이 가야 하는 조부터 위로.
  rows.sort((a, b) => a.score - b.score || b.pending - a.pending || a.name.localeCompare(b.name));

  const latestTbm =
    tbms.length === 0
      ? await prisma.tbm.findFirst({
          where: scope,
          orderBy: { createdAt: "desc" },
          include: { team: true },
        })
      : null;

  // 지금 할 일은 레일과 같은 계산을 쓴다. 따로 짜면 두 숫자가 어긋난다.
  // 지난 날짜를 보고 있을 때는 그날 기준으로 바꿔 말한다.
  const flow = await managerFlow(manager.workplaceId);
  const todo = isToday
    ? flow.next
      ? {
          text: flow.next.label,
          detail:
            flow.pending > 0
              ? [...new Set(pendingDetections.map((d) => ppeLabel(d.ppeCode)))].slice(0, 3).join(", ")
              : "",
          href: flow.next.href,
          cta: flow.next.cta,
        }
      : null
    : pendingDetections.length > 0
      ? {
          text: `${dayLabel} 검토 대기 ${pendingDetections.length}건이 남아 있습니다`,
          detail: [...new Set(pendingDetections.map((d) => ppeLabel(d.ppeCode)))].slice(0, 3).join(", "),
          href: "/manager/detections",
          cta: "검토하러 가기",
        }
      : null;

  return (
    <>
      <PageHead
        eyebrow={
          <span className={`tag ${health ? "tag-safe" : "tag-deny"}`}>
            <span className="dot" aria-hidden />
            {health ? "AI 탐지 사용 가능" : "AI 탐지 중단"}
          </span>
        }
        title={isToday ? "오늘의 안전 현황" : `${formatIsoDateKo(iso)} 안전 현황`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DateNav basePath="/manager" iso={iso} today={today} />
            <Link href="/manager/tbm/new" className="btn-act btn-sm">
              TBM 작성
            </Link>
          </div>
        }
      />

      {/* 지금 할 일 — 한 줄, 하나의 행동. */}
      <section className="mt-5">
        {todo ? (
          <Link
            href={todo.href}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border-2 px-4 py-3.5 transition-colors"
            style={{ borderColor: "var(--act)", background: "var(--act-soft)" }}
          >
            <span className="min-w-0 flex-1 text-[14.5px] font-bold leading-6">
              {todo.text}
              {todo.detail ? (
                <span className="ml-2 font-medium text-ink-2">{todo.detail}</span>
              ) : null}
            </span>
            <span className="text-[13px] font-bold" style={{ color: "var(--act)" }}>
              {todo.cta} →
            </span>
          </Link>
        ) : (
          <p className="rounded-lg border border-rule bg-paper px-4 py-3.5 text-[14px] text-ink-2">
            {isToday ? "오늘 처리할 일이 없습니다. 현장이 정상입니다." : `${dayLabel} 남은 처리 건이 없습니다.`}
          </p>
        )}
      </section>

      {pendingUsers.length > 0 ? (
        <section className="paper mt-4">
          <h2 className="h2">안전관리자 승인 요청</h2>
          <p className="mt-1 text-[13.5px] leading-6 text-ink-2">
            인증번호 없이 안전관리자를 선택한 가입자입니다. 소속을 확인한 뒤 승인해 주세요.
          </p>
          <ul className="mt-3 space-y-2">
            {pendingUsers.map((user) => (
              <li key={user.id} className="well flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-[14px]">
                  <b>{user.name}</b>
                  <span className="num mx-2 text-ink-3">{user.employeeNumber}</span>
                  <span className="text-ink-3">{user.team?.name ?? "미배정"}</span>
                </span>
                <form action={decideManagerApprovalAction} className="flex gap-2">
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

      <section className="mt-7">
        <SectionHead
          title="작업조 현황판"
          count={`${teams.length}개 조`}
          action={
            <span className="text-[11.5px] text-ink-3">
              {formatIsoDateKo(trendDays[0])} – {formatIsoDateKo(iso)}
            </span>
          }
        />
        {rows.length === 0 ? <Empty>등록된 작업조가 없습니다.</Empty> : <TeamBoard rows={rows} basePath="/manager" />}
      </section>

      <section className="mt-7 grid gap-7 lg:grid-cols-2">
        <div>
          <SectionHead title={`${dayLabel}의 TBM`} count={`${tbms.length}건`} />
          {tbms.length === 0 ? (
            <Empty>
              {latestTbm ? (
                <>
                  {dayLabel} 작업일로 등록된 TBM이 없습니다. 가장 최근 TBM은 작업일{" "}
                  <b className="text-ink-2">
                    {formatDate(latestTbm.workDate)}
                  </b>
                  , <b className="text-ink-2">{latestTbm.team.name}</b>입니다.{" "}
                  <Link href={`/manager/tbm/${latestTbm.id}`} className="font-bold underline" style={{ color: "var(--act)" }}>
                    열어 보기
                  </Link>
                </>
              ) : (
                <>
                  아직 작성된 TBM이 없습니다.{" "}
                  <Link href="/manager/tbm/new" className="font-bold underline" style={{ color: "var(--act)" }}>
                    작성하러 가기
                  </Link>
                </>
              )}
            </Empty>
          ) : (
            <ul className="paper-flush ruled">
              {tbms.map((tbm) => {
                return (
                  <li key={tbm.id}>
                    <Link
                      href={`/manager/tbm/${tbm.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">{tbm.workType}</span>
                        <span className="block truncate text-[12.5px] text-ink-3">
                          {tbm.team.name} · {tbm.workArea}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1">
                          <Metric label="안전수칙" value={tbm.rules.length} />
                          <Metric label="확인" value={`${signedOf(tbm)}/${tbm.assignees.length}`} />
                        </span>
                      </span>
                      <span className="shrink-0 text-[13px] text-ink-3">›</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <SectionHead
            title="최근 판정"
            count={`${detections.length}건`}
            action={
              detections.length > 0 ? (
                <Link href="/manager/detections?status=ALL" className="text-[12.5px] font-bold text-ink-2 hover:text-ink">
                  전체 보기
                </Link>
              ) : null
            }
          />
          {detections.length === 0 ? (
            <Empty>{dayLabel} 분석한 영상이 없습니다. 현장 영상 분석에서 캡처 이미지를 올려 보세요.</Empty>
          ) : (
            <ul className="paper-flush ruled">
              {detections.slice(0, 8).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
                  <span className="num text-[12px] text-ink-3">
                    {formatTime(d.detectedAt)}
                  </span>
                  <b className="text-[14px]">{ppeLabel(d.ppeCode)}</b>
                  <span className="text-[12.5px] text-ink-3">
                    {d.tbm.team.name}
                    <span className="num ml-2">{Math.round(d.confidence * 100)}%</span>
                  </span>
                  <span className="ml-auto">
                    <StatusTag status={d.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
