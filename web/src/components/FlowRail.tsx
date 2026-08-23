"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { FlowStage } from "@/lib/flow";

const OVERVIEW = { href: "", label: "현황판", short: "현황" };

function isHere(pathname: string, href: string) {
  if (href === "/manager" || href === "/worker") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ── 데스크톱 좌측 레일 ─────────────────────────────────
   오늘의 순서를 번호로 고정해 두고, 단계마다 상태와 건수를 같이 보여준다.
   "지금 어디에 있나"와 "다음에 뭘 해야 하나"를 한 자리에서 답한다. */

export function RailNav({ overviewHref, stages }: { overviewHref: string; stages: FlowStage[] }) {
  const pathname = usePathname();
  // 1단계가 이미 개요와 같은 화면이면 따로 두지 않는다.
  const showOverview = !stages.some((s) => s.href === overviewHref);

  return (
    <nav className="flex flex-col gap-4 px-3" aria-label="주요 메뉴">
      {showOverview ? (
      <Link
        href={overviewHref}
        aria-current={isHere(pathname, overviewHref) ? "page" : undefined}
        className={`flex min-h-10 items-center gap-2.5 rounded-md px-3 text-[14px] font-bold transition-colors ${
          isHere(pathname, overviewHref)
            ? "bg-act-soft text-act"
            : "text-ink-2 hover:bg-paper-2 hover:text-ink"
        }`}
      >
        <span aria-hidden className="text-[13px]">
          ▣
        </span>
        {OVERVIEW.label}
      </Link>
      ) : null}

      <div>
        <p className="eyebrow px-3 pb-2">오늘의 흐름</p>
        <ul className="flex flex-col gap-0.5">
          {stages.map((s) => (
            <li key={`${s.stage}-${s.href}`}>
              <StageLink stage={s} here={isHere(pathname, s.href)} />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function StageLink({ stage, here }: { stage: FlowStage; here: boolean }) {
  const dim = stage.state === "idle";

  return (
    <Link
      href={stage.href}
      aria-current={here ? "page" : undefined}
      className={`relative flex min-h-11 items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2.5
                  text-[14px] transition-colors ${
                    here
                      ? "bg-act-soft font-bold text-ink"
                      : dim
                        ? "text-ink-3 hover:bg-paper-2"
                        : "font-medium text-ink-2 hover:bg-paper-2 hover:text-ink"
                  }`}
    >
      {/* 지금 보고 있는 화면 표시 — 상태 색과 겹치지 않게 위치로 구분한다. */}
      {here ? (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full"
          style={{ background: "var(--act)" }}
        />
      ) : null}

      <span aria-hidden className="num w-4 shrink-0 text-[12px] font-bold text-ink-3">
        {stage.stage}
      </span>
      <span className="min-w-0 flex-1 truncate">{stage.label}</span>
      <StageValue stage={stage} />
    </Link>
  );
}

/** 오른쪽 끝의 상태 표시. 색만으로 뜻을 전하지 않게 기호와 숫자를 같이 쓴다. */
function StageValue({ stage }: { stage: FlowStage }) {
  if (stage.state === "done") {
    return (
      <span className="shrink-0 text-[13px] font-bold" style={{ color: "var(--safe)" }}>
        <span className="sr-only">완료 </span>✓
      </span>
    );
  }
  if (stage.state === "active") {
    return (
      <span
        className={`shrink-0 rounded-[3px] px-1.5 py-0.5 text-[12px] font-bold ${
          /^\d+$/.test(stage.value) ? "num" : ""
        }`}
        style={{ background: "var(--act)", color: "var(--act-ink)" }}
      >
        <span className="sr-only">처리 필요 </span>
        {stage.value}
      </span>
    );
  }
  return (
    <span className={`num shrink-0 text-[12.5px] ${stage.state === "idle" ? "text-ink-3" : "text-ink-2"}`}>
      {stage.value}
    </span>
  );
}

/* ── 모바일 하단 탭 ─────────────────────────────────────
   레일과 같은 번호를 써서 두 화면이 서로를 가르치게 한다. */

export function BottomTabs({ overviewHref, stages }: { overviewHref: string; stages: FlowStage[] }) {
  const pathname = usePathname();
  const tabs = stages.some((s) => s.href === overviewHref)
    ? stages
    : [{ href: overviewHref, short: OVERVIEW.short, stage: 0, state: "idle" as const, value: "" }, ...stages];

  return (
    <nav
      aria-label="주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg">
        {tabs.map((t) => {
          const here = isHere(pathname, t.href);
          const needsMe = "state" in t && t.state === "active";
          return (
            <li key={`${t.stage}-${t.href}`} className="flex-1">
              <Link
                href={t.href}
                aria-current={here ? "page" : undefined}
                className={`relative flex min-h-[3.4rem] flex-col items-center justify-center gap-0.5
                            text-[11px] font-bold transition-colors ${
                              here ? "text-act" : "text-ink-3"
                            }`}
              >
                {here ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 top-0 h-[2px]"
                    style={{ background: "var(--act)" }}
                  />
                ) : null}
                <span aria-hidden className="num text-[11px] leading-none opacity-70">
                  {t.stage > 0 ? t.stage : "▣"}
                </span>
                {t.short}
                {needsMe ? (
                  <span
                    aria-hidden
                    className="absolute right-[22%] top-2 h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--act)" }}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
