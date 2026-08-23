import { formatTime } from "@/lib/date";

/** 작업자별 확인 서명 현황. TBM 상세와 서명 화면이 같이 쓴다. */

export type SignatureRow = {
  id: string;
  name: string;
  employeeNumber: string;
  signedAt: Date | null;
};

export function SignatureList({ rows }: { rows: SignatureRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-[13px] text-ink-3">이 작업조에 배정된 작업자가 없습니다.</p>;
  }

  return (
    <ul className="ruled">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="min-w-0 truncate text-[14px]">
            {row.name}
            <span className="num ml-2 text-[12px] text-ink-3">{row.employeeNumber}</span>
          </span>
          {row.signedAt ? (
            <span className="shrink-0 text-[12.5px] font-bold" style={{ color: "var(--safe)" }}>
              서명{" "}
              <span className="num">
                {formatTime(row.signedAt)}
              </span>
            </span>
          ) : (
            <span className="shrink-0 text-[12.5px] font-bold" style={{ color: "var(--hold)" }}>
              미확인
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
