"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isAlertMuted, playAlertSound, stopAlertSound } from "@/lib/alertSound";

/**
 * 현황판에 들어올 때마다 뜨는 CCTV 감지 알림.
 *
 * 알림음은 브라우저 자동재생 정책에 걸릴 수 있다. 그 페이지에서 사용자가 아직
 * 아무것도 누르지 않았으면(예: 새로고침으로 바로 들어온 경우) play() 가 거부된다.
 * 그때도 팝업 자체는 뜬다 — 소리는 거들 뿐이고 알림의 본체는 화면이다.
 * 거부된 경우에만 «소리 켜기» 를 띄워 사용자의 클릭으로 재생한다.
 */
export function CctvSimulationPopup() {
  const [open, setOpen] = useState(true);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // 로그인 화면에서 열어 둔 오디오를 그대로 쓴다. 막히면 «소리 켜기» 를 띄운다.
    let alive = true;
    playAlertSound().then((played) => {
      if (alive && !played) setSoundBlocked(true);
    });

    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      alive = false;
      window.removeEventListener("keydown", closeOnEscape);
      // 팝업을 닫으면 소리도 같이 멈춘다.
      stopAlertSound();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cctv-popup-title"
        aria-describedby="cctv-popup-description"
        className="paper w-full max-w-md overflow-hidden shadow-2xl"
      >
        <div className="plate flex items-center justify-between gap-3 px-4 py-3">
          <p className="scan">CCTV EVENT DETECTED</p>
          <span className="tag tag-deny">
            <span className="dot" aria-hidden />
            감지
          </span>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div>
            <p className="eyebrow">실시간 감지 알림</p>
            <h2 id="cctv-popup-title" className="mt-2 text-[1.25rem] font-extrabold">
              CCTV 상황이 발견되었습니다.
            </h2>
            <p id="cctv-popup-description" className="mt-2 text-[13.5px] leading-6 text-ink-2">
              영상 분석으로 가시겠습니까? 수신함에서 감지된 장면과 접근 인원을 확인할 수 있습니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {soundBlocked && !isAlertMuted() ? (
              <button
                type="button"
                className="btn-quiet btn-sm mr-auto"
                onClick={async () => setSoundBlocked(!(await playAlertSound()))}
              >
                소리 켜기
              </button>
            ) : null}
            <button ref={closeRef} type="button" className="btn-quiet btn-sm" onClick={() => setOpen(false)}>
              닫기
            </button>
            <Link href="/manager/analyze" className="btn-act btn-sm" onClick={() => setOpen(false)}>
              영상 분석으로 가기
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
