import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { BottomTabs, RailNav } from "@/components/FlowRail";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IconLogout } from "@/components/icons";
import type { FlowStage } from "@/lib/flow";
import { ROLE_LABEL } from "@/lib/zone";

type ShellUser = {
  name: string;
  role: string;
  employeeNumber: string;
  workplace: { name: string };
};

/**
 * 왼쪽 레일이 방향을 잡아 준다 — 오늘의 순서, 지금 위치, 다음에 할 일.
 * 좁은 화면에서는 레일이 하단 탭으로 내려간다.
 */
export function AppShell({
  user,
  overviewHref,
  stages,
  switchTo,
  children,
}: {
  user: ShellUser;
  overviewHref: string;
  stages: FlowStage[];
  /** 반대편 화면으로 건너가는 링크. 목적지가 아니라 모드 전환이라 신원 영역에 둔다. */
  switchTo?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const roleLabel = ROLE_LABEL[user.role] ?? "작업자";

  return (
    <div className="flex flex-1">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-rule bg-paper lg:flex">
        <div className="px-6 py-5">
          <Link href={overviewHref} className="block">
            <p className="text-[15px] font-extrabold tracking-[-0.02em]">안전한 재가동</p>
            <p className="mt-0.5 text-[12px] text-ink-3">{user.workplace.name}</p>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto pb-4">
          <RailNav overviewHref={overviewHref} stages={stages} />
        </div>

        <div className="border-t border-rule px-4 py-3.5">
          <p className="truncate text-[13px] font-bold">{user.name}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">
            <span className="num">{user.employeeNumber}</span> · {roleLabel}
          </p>
          <div className="mt-2.5 flex items-center gap-1.5">
            {switchTo ? (
              <Link
                href={switchTo.href}
                className="min-h-9 flex-1 rounded-md border border-rule px-2 py-2 text-center
                           text-[12px] font-bold text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
              >
                {switchTo.label}
              </Link>
            ) : (
              <span className="flex-1" />
            )}
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:ml-[232px]">
        {/* 좁은 화면 상단 바 — 레일의 신원·전환만 옮겨 온다. */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-rule bg-paper/90 px-4 backdrop-blur lg:hidden">
          <Link href={overviewHref} className="min-w-0">
            <span className="block truncate text-[14px] font-extrabold tracking-[-0.02em]">
              안전한 재가동
            </span>
            <span className="block truncate text-[11px] text-ink-3">{user.workplace.name}</span>
          </Link>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="tag">{roleLabel}</span>
            {switchTo ? (
              <Link
                href={switchTo.href}
                className="flex h-9 items-center rounded-md border border-rule px-2 text-[12px]
                           font-bold text-ink-2 transition-colors hover:bg-paper-2"
              >
                {switchTo.label}
              </Link>
            ) : null}
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pt-7 lg:pb-10">
          {children}
        </main>

        <BottomTabs overviewHref={overviewHref} stages={stages} />
      </div>
    </div>
  );
}

function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        title="로그아웃"
        aria-label="로그아웃"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-rule
                   bg-paper text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <IconLogout className="h-[17px] w-[17px]" />
      </button>
    </form>
  );
}
