import { Metric } from "@/components/ui";
import { scoreLabel, scoreTone } from "@/lib/score";

export type TeamScoreRow = {
  id: string;
  name: string;
  workArea: string;
  score: number;
  penalty: number;
  memberCount: number;
  workCount: number;
  pendingEvents: number;
  confirmedEvents: number;
  openLocks: number;
};

/** 메인 현황판의 작업조별 오늘 안전 점수. */
export function TeamScoreBoard({ rows }: { rows: TeamScoreRow[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {rows.map((row) => {
        const tone = scoreTone(row.score);
        return (
          <li key={row.id} className="paper flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate text-[14.5px] font-bold">{row.name}</h3>
                <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{row.workArea}</p>
              </div>
              <span
                className="tag shrink-0"
                style={{ color: tone, borderColor: tone }}
              >
                {scoreLabel(row.score)}
              </span>
            </div>

            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">오늘 부과 기준 조 점수</p>
                <p className="mt-1 text-[12px] text-ink-3">
                  오늘 부과 {row.confirmedEvents}건 · 감점 {row.penalty}점
                </p>
              </div>
              <p className="sign shrink-0 text-[2.75rem] leading-none" style={{ color: tone }}>
                {row.score}
                <span className="ml-1 text-[0.875rem] font-medium text-ink-3">/100</span>
              </p>
            </div>

            <div
              role="progressbar"
              aria-label={`${row.name} 오늘 부과 기준 조 점수`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={row.score}
              className="h-1.5 overflow-hidden rounded-[1px] bg-rule-soft"
            >
              <div className="h-full" style={{ width: `${row.score}%`, background: tone }} />
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <Metric label="조원" value={`${row.memberCount}명`} />
              <Metric label="오늘 작업" value={`${row.workCount}건`} />
              <Metric label="검토 대기" value={`${row.pendingEvents}건`} />
              <Metric label="미해제 시건" value={`${row.openLocks}건`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
