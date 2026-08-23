"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { pendingAlertsAction } from "@/app/actions/notify";

type Alerts = Awaited<ReturnType<typeof pendingAlertsAction>>;

/**
 * 즉시 통보.
 *
 * 위험 사건은 관리자가 화면을 새로고침할 때까지 기다려 주지 않는다.
 * REST 라우트를 늘리지 않으려고 읽기 전용 서버 액션을 주기적으로 부른다.
 */
export function AlertPoller({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const baseline = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const next = await pendingAlertsAction();
        if (cancelled) return;
        setAlerts(next);
        const total = next.riskPending;
        if (baseline.current != null && total > baseline.current) router.refresh();
        baseline.current = total;
      } catch {
        /* 폴링 실패는 조용히 넘긴다 — 다음 주기에 다시 시도한다 */
      }
    }

    void check();
    const timer = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs, router]);

  if (!alerts || alerts.criticalPending === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md px-4 py-3"
      style={{ border: "2px solid var(--deny)", background: "var(--deny-soft)" }}
    >
      <p className="text-[13.5px] font-bold" style={{ color: "var(--deny)" }}>
        위험 등급 사건 {alerts.criticalPending}건이 검토를 기다립니다
      </p>
      <Link href="/manager/analyze" className="btn-deny btn-sm">
        지금 확인
      </Link>
    </div>
  );
}
