import { requireManager } from "@/lib/auth";
import { safetyMetrics } from "@/lib/metrics";
import { PageHead, SectionHead, Empty } from "@/components/ui";
import { DateNav } from "@/components/DateNav";
import {
  dayRange,
  formatDurationKo,
  formatIsoDateKoLong,
  lastIsoDays,
  resolveDateParam,
  todayLocalISO,
} from "@/lib/date";

function pct(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function secs(value: number | null) {
  return value == null ? "—" : formatDurationKo(value);
}

/** 큰 계측값 하나 + 설명. 지표는 숫자만 던지면 아무 뜻이 없다. */
function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className="paper flex flex-col gap-1.5 p-4">
      <p className="eyebrow">{label}</p>
      <p className="sign text-[1.75rem] leading-none" style={{ color: tone }}>
        {value}
      </p>
      <p className="text-[12.5px] leading-5 text-ink-3">{note}</p>
    </div>
  );
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; range?: string }>;
}) {
  const manager = await requireManager();
  const params = await searchParams;
  const iso = resolveDateParam(params.date);
  const weekly = params.range === "week";

  const days = weekly ? lastIsoDays(iso, 7) : [iso];
  const from = dayRange(days[0]).from;
  const to = dayRange(days[days.length - 1]).to;
  const metrics = await safetyMetrics(manager.workplaceId, from, to);

  const peakHour = Math.max(1, ...metrics.exposure.byHour);
  const peakZone = Math.max(1, ...metrics.exposure.byZone.map((z) => z.sec));

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="도입 효과 지표"
        sub="사고 건수로 효과를 주장하지 않습니다. 실제로 잰 시간과 횟수로만 이야기합니다."
        action={<DateNav iso={iso} today={todayLocalISO()} basePath="/manager/metrics" />}
      />

      <p className="text-[13px] text-ink-2">
        {weekly ? `${formatIsoDateKoLong(days[0])} ~ ` : ""}
        {formatIsoDateKoLong(iso)} 기준 ·{" "}
        <a
          href={`/manager/metrics?date=${iso}&range=${weekly ? "day" : "week"}`}
          className="font-bold text-act underline"
        >
          {weekly ? "하루만 보기" : "최근 7일로 보기"}
        </a>
      </p>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          label="위험 감지 소요시간"
          value={secs(metrics.detectLatency.avgSec)}
          note={`구역 진입부터 위험 판정까지. 95분위 ${secs(metrics.detectLatency.p95Sec)} · ${metrics.detectLatency.n}건`}
        />
        <Tile
          label="관리자 조치 소요시간"
          value={secs(metrics.response.ackSec)}
          note={`통보 후 확인까지. 판단 ${secs(metrics.response.judgeSec)} · 현장 조치 ${secs(metrics.response.clearSec)}`}
        />
        <Tile
          label="위험구역 노출시간"
          value={formatDurationKo(metrics.exposure.totalSec)}
          note="작업자가 위험구역 안에 있었던 시간의 합"
        />
        <Tile
          label="차단한 위험 재가동"
          value={`${metrics.blocked.requests}회`}
          note={`자동 인터록 ${metrics.blocked.autoInterlocks}건 중 사람이 위험으로 확정한 것 ${metrics.blocked.confirmed}건`}
          tone={metrics.blocked.confirmed > 0 ? "var(--deny)" : undefined}
        />
        <Tile
          label="CCTV 확인 업무시간"
          value={pct(metrics.reviewLoad.savedRatio)}
          note={`전체 ${formatDurationKo(metrics.reviewLoad.footageSec)} 중 실제로 본 구간 ${formatDurationKo(metrics.reviewLoad.watchedSec)} — 나머지는 안 봐도 됐다`}
        />
        <Tile
          label="오탐 / 미탐"
          value={`${pct(metrics.accuracy.falsePositiveRate)} / ${pct(metrics.accuracy.missRate)}`}
          note={`확정 ${metrics.accuracy.confirmed} · 오탐 ${metrics.accuracy.falsePositive} · 관리자 직접 등록 ${metrics.accuracy.missed} · 미판단 ${metrics.accuracy.undecided}건은 분모에서 제외`}
        />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="반복되는 위험 시간대" />
        {metrics.exposure.totalSec === 0 ? (
          <Empty>이 기간에 기록된 노출이 없습니다.</Empty>
        ) : (
          <div className="paper p-4">
            <div className="flex items-end gap-[3px]" aria-hidden>
              {metrics.exposure.byHour.map((sec, hour) => (
                <span key={hour} className="flex flex-1 flex-col items-center gap-1">
                  <span
                    title={`${hour}시 ${formatDurationKo(sec)}`}
                    className="w-full rounded-[1px]"
                    style={{
                      height: `${Math.max(2, (sec / peakHour) * 72)}px`,
                      background: sec > 0 ? "var(--chart-penalty)" : "var(--rule)",
                    }}
                  />
                  {hour % 3 === 0 ? (
                    <span className="num text-[10px] text-ink-3">{hour}</span>
                  ) : (
                    <span className="h-[13px]" />
                  )}
                </span>
              ))}
            </div>
            <p className="sr-only">
              시간대별 노출시간:{" "}
              {metrics.exposure.byHour
                .map((sec, hour) => (sec > 0 ? `${hour}시 ${formatDurationKo(sec)}` : null))
                .filter(Boolean)
                .join(", ") || "없음"}
            </p>
            <p className="mt-2 text-[12px] text-ink-3">현장 시간(Asia/Seoul) 기준</p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="구역별 노출" count={`${metrics.exposure.byZone.length}곳`} />
        {metrics.exposure.byZone.length === 0 ? (
          <Empty>이 기간에 기록된 구역 노출이 없습니다.</Empty>
        ) : (
          <ul className="ruled paper">
            {metrics.exposure.byZone.map((zone) => (
              <li key={zone.zoneId} className="flex items-center gap-3 px-4 py-3">
                <span className="w-32 shrink-0 truncate text-[13.5px] font-bold">{zone.name}</span>
                <span className="h-3 flex-1 overflow-hidden rounded-[2px]" style={{ background: "var(--rule-soft)" }}>
                  <span
                    className="block h-full"
                    style={{
                      width: `${Math.max(2, (zone.sec / peakZone) * 100)}%`,
                      background: "var(--chart-penalty)",
                    }}
                  />
                </span>
                <span className="num w-20 shrink-0 text-right text-[13px] font-bold">
                  {formatDurationKo(zone.sec)}
                </span>
                <span className="num w-12 shrink-0 text-right text-[12.5px] text-ink-3">
                  {zone.events}건
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
