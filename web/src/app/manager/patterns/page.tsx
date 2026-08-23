import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { patternReport, EQUIPMENT_KIND_LABEL, formatWon, type PatternAlert } from "@/lib/patterns";
import { PageHead, SectionHead, Empty } from "@/components/ui";
import {
  dayRange,
  formatDurationKo,
  formatIsoDateKoLong,
  lastIsoDays,
  resolveDateParam,
} from "@/lib/date";

/** 패턴은 하루로 못 본다. 기본 창을 30일로 두고 7일로 좁힐 수 있게 한다. */
const DEFAULT_DAYS = 30;

function secs(value: number | null) {
  return value == null ? "—" : formatDurationKo(value);
}

function Tile({ label, value, note, tone }: {
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

function AlertCard({ alert }: { alert: PatternAlert }) {
  const high = alert.severity === "HIGH";
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md px-4 py-3.5"
      style={{
        border: `2px solid ${high ? "var(--deny)" : "var(--rule)"}`,
        background: high ? "var(--deny-soft)" : "var(--paper-2)",
      }}
    >
      <p className="text-[14px] font-bold">{alert.headline}</p>
      <p className="text-[12.5px] leading-5 text-ink-2">{alert.detail}</p>
    </div>
  );
}

export default async function PatternsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; range?: string }>;
}) {
  const manager = await requireManager();
  const params = await searchParams;
  const iso = resolveDateParam(params.date);
  const span = params.range === "week" ? 7 : DEFAULT_DAYS;

  const days = lastIsoDays(iso, span);
  const from = dayRange(days[0]).from;
  const to = dayRange(days[days.length - 1]).to;
  const report = await patternReport(manager.workplaceId, from, to);

  const peakEquipment = report.byEquipment[0];
  const peakHour = peakEquipment ? Math.max(1, ...peakEquipment.byHour) : 1;

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="반복 패턴"
        sub="사고를 세지 않습니다. 사고가 나기 전에 같은 상황이 몇 번 반복됐는지를 셉니다."
      />

      <p className="text-[13px] text-ink-2">
        {formatIsoDateKoLong(days[0])} ~ {formatIsoDateKoLong(iso)} ({span}일) 기준 ·{" "}
        <a
          href={`/manager/patterns?date=${iso}&range=${span === 7 ? "month" : "week"}`}
          className="font-bold text-act underline"
        >
          {span === 7 ? `최근 ${DEFAULT_DAYS}일로 보기` : "최근 7일로 보기"}
        </a>
      </p>

      <section className="flex flex-col gap-3">
        <SectionHead title="발견된 패턴" count={`${report.alerts.length}건`} />
        {report.alerts.length === 0 ? (
          <Empty>
            반복으로 볼 만한 패턴이 아직 없습니다. 정지 에피소드가 쌓이면 여기에 나타납니다.
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {report.alerts.map((alert, index) => (
              <AlertCard key={`${alert.code}-${alert.equipmentId}-${index}`} alert={alert} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          label="걸림 대응 정지"
          value={`${report.jamEpisodes}회`}
          note={`전체 정지 ${report.episodes}회 중 걸림 대응으로 분류된 것. 계획 정비는 제외됩니다.`}
        />
        <Tile
          label="위험구역 접근 동반"
          value={`${report.approachEpisodes}회`}
          note="정지 구간 안에서 작업자가 위험구역에 들어간 건수"
          tone={report.approachEpisodes > 0 ? "var(--deny)" : undefined}
        />
        <Tile
          label="평균 복구시간"
          value={secs(report.avgRecoverySec)}
          note="정지부터 재가동까지. 재가동 전인 건은 평균에서 빠집니다."
        />
        <Tile
          label="누적 생산중단시간"
          value={formatDurationKo(report.totalDowntimeSec)}
          note="걸림 대응 정지의 합. 계획 정비는 예정된 정지라 빼고 셉니다."
        />
        {report.totalCostWon != null ? (
          <Tile
            label="생산손실 환산"
            value={formatWon(report.totalCostWon)}
            note={
              report.costCoverage.priced < report.costCoverage.total
                ? `설비 ${report.costCoverage.total}대 중 단가가 입력된 ${report.costCoverage.priced}대만 계산했습니다. 실제 손실은 이보다 큽니다.`
                : "설비별 분당 손실단가 × 중단시간. 단가는 관리자가 입력한 값입니다."
            }
          />
        ) : (
          <Tile
            label="생산손실 환산"
            value="—"
            note="설비에 분당 손실단가가 입력되지 않았습니다. 우리가 추정하지 않습니다."
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="설비별" count={`${report.byEquipment.length}대`} />
        {report.byEquipment.length === 0 ? (
          <Empty>이 기간에 기록된 정지 에피소드가 없습니다.</Empty>
        ) : (
          <div className="paper overflow-x-auto">
            <table className="w-full min-w-[680px] text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="px-4 py-2.5 font-bold">설비</th>
                  <th className="px-3 py-2.5 text-right font-bold">걸림</th>
                  <th className="px-3 py-2.5 text-right font-bold">위험접근</th>
                  <th className="px-3 py-2.5 text-right font-bold">평균 복구</th>
                  <th className="px-3 py-2.5 text-right font-bold">누적 중단</th>
                  <th className="px-4 py-2.5 text-right font-bold">손실 환산</th>
                </tr>
              </thead>
              <tbody className="ruled">
                {report.byEquipment.map((row) => (
                  <tr key={row.equipmentId}>
                    <td className="px-4 py-3">
                      <span className="font-bold">{row.name}</span>
                      <span className="ml-2 text-[12px] text-ink-3">
                        {row.code} · {EQUIPMENT_KIND_LABEL[row.kind] ?? row.kind}
                      </span>
                    </td>
                    <td className="num px-3 py-3 text-right">{row.jamEpisodes}</td>
                    <td className="num px-3 py-3 text-right font-bold">
                      {row.approachEpisodes}
                      {row.approachRatio != null ? (
                        <span className="ml-1 text-[11.5px] font-normal text-ink-3">
                          {Math.round(row.approachRatio * 100)}%
                        </span>
                      ) : null}
                    </td>
                    <td className="num px-3 py-3 text-right">{secs(row.avgRecoverySec)}</td>
                    <td className="num px-3 py-3 text-right">
                      {row.totalDowntimeSec > 0 ? formatDurationKo(row.totalDowntimeSec) : "—"}
                    </td>
                    <td className="num px-4 py-3 text-right">
                      {row.costWon != null ? formatWon(row.costWon) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[12px] text-ink-3">
          단가는{" "}
          <Link href="/manager/equipment" className="font-bold text-act underline">
            설비 관리
          </Link>{" "}
          에서 설비마다 입력합니다. 입력하지 않으면 금액 칸이 비어 있습니다.
        </p>
      </section>

      {peakEquipment ? (
        <section className="flex flex-col gap-3">
          <SectionHead
            title="걸림이 반복되는 시간대"
            count={peakEquipment.name}
          />
          <div className="paper p-4">
            <div className="flex items-end gap-[3px]" aria-hidden>
              {peakEquipment.byHour.map((count, hour) => (
                <span key={hour} className="flex flex-1 flex-col items-center gap-1">
                  <span
                    title={`${hour}시 ${count}회`}
                    className="w-full rounded-[1px]"
                    style={{
                      height: `${Math.max(2, (count / peakHour) * 72)}px`,
                      background: count > 0 ? "var(--chart-penalty)" : "var(--rule)",
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
              시간대별 걸림 횟수:{" "}
              {peakEquipment.byHour
                .map((count, hour) => (count > 0 ? `${hour}시 ${count}회` : null))
                .filter(Boolean)
                .join(", ") || "없음"}
            </p>
            <p className="mt-2 text-[12px] text-ink-3">
              현장 시간(Asia/Seoul) 기준 · 교대 시간과 겹치면 인력 배치를 함께 봐야 합니다.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
