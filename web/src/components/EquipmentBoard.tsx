import Link from "next/link";
import { InterlockBadge, RunStateTag } from "@/components/ui";
import { exposureTone } from "@/lib/metrics";
import { formatDurationKo } from "@/lib/date";

export type EquipmentRow = {
  id: string;
  code: string;
  name: string;
  line: string;
  runState: string;
  interlock: string;
  interlockReason: string;
  zoneCount: number;
  /** 오늘 이 설비에서 사람이 위험구역에 노출된 시간 */
  exposureSec: number;
  pendingEvents: number;
  openLocks: number;
  /** 최근 7일 노출시간. 색이 아니라 높이로 값을 말한다. */
  week: { iso: string; sec: number }[];
};

/**
 * 설비 현황판.
 *
 * 큰 숫자 자리에는 점수가 아니라 노출시간이 들어간다. 이 시스템에서 작업자는
 * 처벌 대상이 아니라 보호 대상이다 — 감점제를 쓰면 "위험구역에 들어간 사람을 깎는다"는
 * 메시지가 되어 현장 수용성 논리를 스스로 무너뜨린다.
 */
export function EquipmentBoard({ rows }: { rows: EquipmentRow[] }) {
  if (rows.length === 0) return null;
  const peak = Math.max(1, ...rows.flatMap((r) => r.week.map((d) => d.sec)));

  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {rows.map((row) => (
        <li key={row.id} className="paper flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-[12.5px] font-bold text-ink-3">{row.code}</span>
            <h3 className="text-[14.5px] font-bold">{row.name}</h3>
            <span className="ml-auto flex items-center gap-1.5">
              <RunStateTag state={row.runState} />
              <InterlockBadge interlock={row.interlock} reason={row.interlockReason} />
            </span>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">오늘 위험구역 노출</p>
              <p
                className="sign text-[2rem] leading-none"
                style={{ color: exposureTone(row.exposureSec) }}
              >
                {row.exposureSec > 0 ? formatDurationKo(row.exposureSec) : "0초"}
              </p>
            </div>

            <div className="flex items-end gap-[3px]" aria-hidden>
              {row.week.map((day) => (
                <span
                  key={day.iso}
                  title={`${day.iso} ${formatDurationKo(day.sec)}`}
                  className="w-[7px] rounded-[1px]"
                  style={{
                    height: `${Math.max(3, (day.sec / peak) * 34)}px`,
                    background: day.sec > 0 ? exposureTone(day.sec) : "var(--rule)",
                  }}
                />
              ))}
            </div>
          </div>
          <p className="sr-only">
            최근 7일 노출시간:{" "}
            {row.week.map((d) => `${d.iso} ${formatDurationKo(d.sec)}`).join(", ")}
          </p>

          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            <span className="flex items-baseline gap-1.5">
              <dt className="text-ink-3">위험구역</dt>
              <dd className="num font-bold">{row.zoneCount}</dd>
            </span>
            <span className="flex items-baseline gap-1.5">
              <dt className="text-ink-3">검토 대기</dt>
              <dd className="num font-bold" style={{ color: row.pendingEvents > 0 ? "var(--act)" : undefined }}>
                {row.pendingEvents}
              </dd>
            </span>
            <span className="flex items-baseline gap-1.5">
              <dt className="text-ink-3">미해제 시건</dt>
              <dd className="num font-bold">{row.openLocks}</dd>
            </span>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Link href={`/manager/equipment/${row.id}/zones`} className="btn-quiet btn-sm">
              위험구역
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
