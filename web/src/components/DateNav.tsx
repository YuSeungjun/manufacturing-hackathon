"use client";

import { useRouter } from "next/navigation";
import { formatIsoDateKoLong, shiftIsoDate } from "@/lib/date";

/**
 * 보고 있는 날짜를 옮긴다.
 * 오늘은 주소에 날짜를 붙이지 않아, 공유된 링크가 늘 그날의 현황을 가리킨다.
 */
export function DateNav({
  basePath,
  iso,
  today,
}: {
  basePath: string;
  iso: string;
  /** 서버가 계산한 오늘. 클라이언트에서 다시 구하면 시간대가 다를 때 어긋난다. */
  today: string;
}) {
  const router = useRouter();
  const isToday = iso === today;

  function go(next: string) {
    router.push(next === today ? basePath : `${basePath}?date=${next}`);
  }

  return (
    <div className="flex items-center gap-1">
      <Arrow label="이전 날" onClick={() => go(shiftIsoDate(iso, -1))}>
        ‹
      </Arrow>

      {/* 날짜 칸 전체가 달력을 여는 버튼이다. */}
      <label
        className="relative flex min-h-9 cursor-pointer items-center rounded-md border border-rule
                   bg-paper px-3 text-[13px] font-medium transition-colors hover:bg-paper-2
                   focus-within:outline focus-within:outline-2 focus-within:outline-offset-2
                   focus-within:outline-accent"
      >
        <span>{formatIsoDateKoLong(iso)}</span>
        <span className="sr-only">보고 있는 날짜 바꾸기</span>
        <input
          type="date"
          value={iso}
          onChange={(event) => event.target.value && go(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>

      <Arrow label="다음 날" onClick={() => go(shiftIsoDate(iso, 1))}>
        ›
      </Arrow>

      {isToday ? null : (
        <button
          type="button"
          onClick={() => go(today)}
          className="ml-1 min-h-9 cursor-pointer rounded-md border-2 px-3 text-[13px]
                     font-bold transition-colors"
          style={{ borderColor: "var(--act)", color: "var(--act)" }}
        >
          오늘
        </button>
      )}
    </div>
  );
}

function Arrow({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md
                 border border-rule bg-paper text-ink-2 transition-colors
                 hover:bg-paper-2 hover:text-ink"
    >
      {children}
    </button>
  );
}
