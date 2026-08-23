import Link from "next/link";
import { formatIsoDateKoLong } from "@/lib/date";
import { scoreTone } from "@/lib/score";

/**
 * 작업조 현황판 — 오늘 점수와 최근 7일 추이를 한 줄에 놓는다.
 * 예전에는 타일 섹션과 추이 표가 따로 있었다. 같은 대상을 두 번 보여줄 이유가 없다.
 *
 * 막대는 감점(크기)을 높이로 나타내고 색은 거기 따라붙기만 한다.
 * 빨강/노랑/초록 3단계 상태색은 적록색약에서 구분되지 않아(검증기 ΔE 0.1) 쓰지 않았다.
 * "감점 있음"은 높이를 가진 막대, "무감점"은 바닥의 납작한 선으로 모양을 달리했다.
 */

export type DayCell = {
  iso: string;
  /** 그날 이 작업조에 TBM 이 있었는가. 없으면 '0점'이 아니라 '자료 없음'이다. */
  hasTbm: boolean;
  penalty: number;
  confirmed: number;
};

export type TeamRow = {
  teamId: string;
  name: string;
  workArea: string;
  score: number;
  signed: number;
  expected: number;
  pending: number;
  confirmed: number;
  cells: DayCell[];
};

const TRACK = 26;

export function TeamBoard({ rows, basePath }: { rows: TeamRow[]; basePath: string }) {
  const scaleMax = Math.max(40, ...rows.flatMap((r) => r.cells.map((c) => c.penalty)));

  return (
    <div className="paper-flush">
      <ul className="ruled">
        {rows.map((row) => (
          <li
            key={row.teamId}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 px-4 py-3
                       lg:grid-cols-[minmax(0,1fr)_4.5rem_10rem_auto] lg:gap-x-5"
          >
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-bold">{row.name}</p>
              <p className="truncate text-[12.5px] text-ink-3">{row.workArea}</p>
              <p className="sr-only">
                오늘 안전이행 {row.score}점, 서명 {row.expected === 0 ? "대상 없음" : `${row.signed}/${row.expected}명`},
                검토 대기 {row.pending}건, 확정 위반 {row.confirmed}건
              </p>
            </div>

            {/* 점수 — 표지 서체. 이 행에서 가장 먼저 읽혀야 하는 값. */}
            <p
              className="sign whitespace-nowrap text-right text-[1.75rem] leading-none"
              style={{ color: scoreTone(row.score) }}
              aria-hidden
            >
              {row.score}
            </p>

            <div className="col-span-2 lg:col-span-1">
              <Sparks cells={row.cells} scaleMax={scaleMax} basePath={basePath} team={row.name} />
            </div>

            <div
              className="col-span-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 lg:col-span-1 lg:justify-end"
              aria-hidden
            >
              <Tick label="서명" value={row.expected === 0 ? "—" : `${row.signed}/${row.expected}`} />
              <Tick label="대기" value={row.pending} tone={row.pending > 0 ? "hold" : undefined} />
              <Tick label="확정" value={row.confirmed} tone={row.confirmed > 0 ? "deny" : undefined} />
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule px-4 py-2.5">
        <Legend swatch={<i className="h-[11px] w-[7px] rounded-t-[3px]" style={{ background: "var(--chart-penalty)" }} />}>
          감점 — 높을수록 큼
        </Legend>
        <Legend swatch={<i className="h-[3px] w-[11px] rounded-[2px]" style={{ background: "var(--chart-clear)" }} />}>
          감점 없음
        </Legend>
        <Legend swatch={<i className="h-[2px] w-[7px] rounded-full bg-ink-3 opacity-35" />}>TBM 없음</Legend>
        <span className="ml-auto text-[11.5px] text-ink-3">칸을 누르면 그날 현황으로</span>
      </div>
    </div>
  );
}

function Sparks({
  cells,
  scaleMax,
  basePath,
  team,
}: {
  cells: DayCell[];
  scaleMax: number;
  basePath: string;
  team: string;
}) {
  return (
    <div className="flex items-end gap-[3px]">
      {cells.map((cell, i) => {
        const reading = !cell.hasTbm
          ? "TBM 없음"
          : cell.penalty === 0
            ? "감점 없음 · 100점"
            : `확정 ${cell.confirmed}건 · 감점 ${cell.penalty}점 · ${100 - cell.penalty}점`;
        const edge = i === 0 ? "tip-start" : i === cells.length - 1 ? "tip-end" : "";
        // 감점 막대는 최소 4px 을 줘서 -10 점도 눈에 걸리게 한다.
        const h = cell.penalty > 0 ? Math.max(4, Math.round((cell.penalty / scaleMax) * TRACK)) : 0;

        return (
          <Link
            key={cell.iso}
            href={`${basePath}?date=${cell.iso}`}
            aria-label={`${team} ${formatIsoDateKoLong(cell.iso)} ${reading}`}
            className="tipwrap flex flex-1 items-end justify-center rounded-[2px] outline-offset-2"
            style={{ height: TRACK }}
          >
            <span className={`tip ${edge}`} role="tooltip">
              {formatIsoDateKoLong(cell.iso)} · {reading}
            </span>
            {!cell.hasTbm ? (
              <i aria-hidden className="h-[2px] w-[7px] rounded-full bg-ink-3 opacity-35" />
            ) : cell.penalty === 0 ? (
              <i
                aria-hidden
                className="h-[3px] w-full max-w-[16px] rounded-[2px]"
                style={{ background: "var(--chart-clear)" }}
              />
            ) : (
              <i
                aria-hidden
                className="w-full max-w-[16px] rounded-t-[3px]"
                style={{ height: h, background: "var(--chart-penalty)" }}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}

function Tick({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "hold" | "deny" }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[11px] font-bold text-ink-3">{label}</span>
      <span
        className="num text-[12.5px] font-bold"
        style={tone ? { color: `var(--${tone})` } : undefined}
      >
        {value}
      </span>
    </span>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
      <span className="flex h-3 w-[11px] shrink-0 items-end justify-center" aria-hidden>
        {swatch}
      </span>
      {children}
    </span>
  );
}
