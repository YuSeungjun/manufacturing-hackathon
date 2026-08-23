"use client";

import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "@/components/icons";

type Theme = "light" | "dark";

/* 테마는 React 밖(문서 요소와 OS 설정)에 있으므로 외부 저장소로 읽는다. */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onChange);
  };
}

function readTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "dark" || chosen === "light") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 서버는 어떤 테마인지 알 수 없다. 정해지기 전에는 자리만 잡아 둔다. */
function readOnServer(): Theme | null {
  return null;
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme | null>(subscribe, readTheme, readOnServer);

  if (theme === null) {
    return <div className="h-9 w-9 shrink-0" aria-hidden />;
  }

  const next: Theme = theme === "dark" ? "light" : "dark";
  const Icon = next === "dark" ? IconMoon : IconSun;
  const labelText = next === "dark" ? "다크 모드로 전환" : "라이트 모드로 전환";

  function switchTheme() {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // 저장이 막혀 있어도 이번 세션 동안은 바뀐 채로 둔다.
    }
    listeners.forEach((notify) => notify());
  }

  return (
    <button
      type="button"
      onClick={switchTheme}
      title={labelText}
      aria-label={labelText}
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md
                 border border-rule bg-paper text-ink-2 transition-colors
                 hover:bg-paper-2 hover:text-ink"
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
