import { formatStamp } from "@/lib/date";

export type LotoRow = {
  userId: string;
  name: string;
  employeeNumber: string;
  lockedAt: Date | null;
  releasedAt: Date | null;
  isMe?: boolean;
};

/** 누가 시건을 걸고 풀었는지. 이 목록이 비어야 설비가 다시 돈다. */
export function LotoList({ rows }: { rows: LotoRow[] }) {
  return (
    <ul className="ruled rounded-md border border-rule-soft">
      {rows.map((row) => {
        const state = row.lockedAt == null ? "none" : row.releasedAt == null ? "locked" : "released";
        return (
          <li key={row.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="text-[13.5px] font-bold">
              {row.name}
              {row.isMe ? <span className="ml-1.5 text-[11.5px] text-ink-3">나</span> : null}
            </span>
            <span className="num text-[12px] text-ink-3">{row.employeeNumber}</span>
            <span className="ml-auto flex items-center gap-2">
              {state === "locked" ? (
                <span className="tag tag-deny">
                  <span aria-hidden>🔒</span> 시건 중
                </span>
              ) : state === "released" ? (
                <span className="tag tag-safe">
                  <span aria-hidden>✓</span> 해제됨
                </span>
              ) : (
                <span className="tag">미시건</span>
              )}
              <span className="num text-[12px] text-ink-3">
                {row.releasedAt
                  ? formatStamp(row.releasedAt)
                  : row.lockedAt
                    ? formatStamp(row.lockedAt)
                    : "—"}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
