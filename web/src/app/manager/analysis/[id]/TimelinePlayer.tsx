"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LEVEL_MARK,
  levelLabel,
  levelTone,
  polygonPoints,
  riskCodeLabel,
  type RiskLevel,
  type TimelineFrame,
  type ZonePoint,
} from "@/lib/zone";
import { formatClock, formatDurationKo } from "@/lib/date";

type ZoneShape = { id: string; name: string; polygon: ZonePoint[] };

/** 안전대 판정 — 사람 박스와 그 사람에 대한 착용 추정. */
export type HarnessFrame = {
  verdict: string;
  confidence: number;
  provider: string;
  hookVerdict?: string;
  boxes: {
    x: number; y: number; w: number; h: number;
    status: string; confidence: number;
    hookStatus?: string; hookConfidence?: number;
  }[];
};

const HARNESS_TEXT: Record<string, string> = {
  WORN: "안전대 착용",
  NOT_WORN: "안전대 미착용",
  UNKNOWN: "안전대 판정불가",
};

/**
 * 훅 체결은 착용과 **따로** 적는다.
 *
 * "하네스는 입었는데 훅을 안 걸었다" 가 추락에서 실제로 사람이 죽는 상태다. 그걸
 * "안전대 착용" 한 줄로 덮으면 가장 중요한 걸 가린다.
 */
const HOOK_TEXT: Record<string, string> = {
  ATTACHED: "훅 체결",
  NOT_ATTACHED: "훅 미체결",
  UNKNOWN: "훅 판정불가",
};

function harnessLabel(status: string, confidence: number, hookStatus?: string, hookConfidence?: number) {
  const head = `${HARNESS_TEXT[status] ?? status}${confidence > 0 ? ` ${Math.round(confidence * 100)}%` : ""}`;
  // 착용이 확인된 사람에게만 훅을 붙인다. 하네스가 없으면 훅도 없다.
  if (status !== "WORN" || !hookStatus) return head;
  const tail = `${HOOK_TEXT[hookStatus] ?? hookStatus}${
    hookConfidence && hookConfidence > 0 ? ` ${Math.round(hookConfidence * 100)}%` : ""
  }`;
  return `${head} · ${tail}`;
}

/**
 * 판정에 실제로 쓴 상체 영역.
 *
 * 사람 bbox 전체가 아니라 위쪽 70% 만 잘라 분류기에 넘긴다(ai/config.HARNESS_CROP_BOTTOM).
 * 화면에도 그 영역을 그린다 — "훅을 탐지했다" 가 아니라 **"이 영역을 보고 이렇게 판정했다"**
 * 가 정확한 설명이고, 그 둘을 섞으면 안 된다.
 */
const HARNESS_CROP_BOTTOM = 0.7;
type EventMark = {
  id: string;
  code: string;
  level: RiskLevel;
  startSec: number;
  endSec: number;
  peakSec: number;
  dwellSec: number;
  zoneName: string;
  reason: string;
};

/** frames 는 t 오름차순이 보장된다. 이진 탐색으로 현재 프레임을 찾는다. */
function frameIndexAt(frames: TimelineFrame[], t: number): number {
  let low = 0;
  let high = frames.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (frames[mid].tSec <= t) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export function TimelinePlayer({
  videoPath,
  posterPath,
  sourceKind,
  frameUrls,
  harnessApplies = false,
  harnessByFrame = [],
  durationSec,
  frames,
  zones,
  events,
  activeEventId,
}: {
  videoPath: string;
  posterPath: string;
  sourceKind: string;
  frameUrls: string[];
  /** 추락 구역인가. 끼임 구역에서는 안전대·훅이 판정 대상이 아니라 아예 감춘다. */
  harnessApplies?: boolean;
  /** 프레임 순서와 같은 길이. 판정을 아직 안 돌렸으면 빈 배열이다. */
  harnessByFrame?: HarnessFrame[];
  durationSec: number;
  frames: TimelineFrame[];
  zones: ZoneShape[];
  events: EventMark[];
  activeEventId?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);
  const duration = durationSec || frames.at(-1)?.tSec || 1;
  const isFrameSequence = sourceKind === "FRAMES" && frameUrls.length > 0;

  // timeupdate 는 250ms 간격이라 박스가 끊겨 보인다. rAF 로 따라간다.
  useEffect(() => {
    if (frames.length === 0 || isFrameSequence) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) setIndex(frameIndexAt(frames, video.currentTime));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames, isFrameSequence]);

  const seek = useCallback((t: number) => {
    if (isFrameSequence) {
      setIndex(frameIndexAt(frames, t));
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, t);
    void video.play().catch(() => setPlaying(false));
  }, [frames, isFrameSequence]);

  const current = frames[index];
  const dwellByZone = current?.zoneDwell ?? {};
  const occupancyByZone = current?.zoneOccupancy ?? {};

  if (isFrameSequence) {
    const safeIndex = Math.min(index, frameUrls.length - 1, Math.max(0, frames.length - 1));
    const frame = frames[safeIndex];
    const persons = frame?.persons ?? [];

    return (
      <div className="flex flex-col gap-2" role="group" aria-label="분석 이미지 탐색기">
        <div className="plate overflow-hidden">
          <div className="relative">
            {/* 분석 전 수신함에서는 원본만 보이고, 이 결과 화면에서 사람 박스를 공개한다. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={frameUrls[safeIndex]}
              alt={`분석 이미지 ${safeIndex + 1}`}
              className="block h-auto w-full"
            />

            {persons.map((person, personIndex) => (
              <span
                key={`${person.trackId ?? "person"}-${personIndex}`}
                className="pointer-events-none absolute"
                style={{
                  left: `${person.x * 100}%`,
                  top: `${person.y * 100}%`,
                  width: `${person.w * 100}%`,
                  height: `${person.h * 100}%`,
                  border: "2px solid var(--scan)",
                }}
              >
                <span
                  className="absolute -top-[1.15rem] left-[-2px] whitespace-nowrap px-1 py-[1px]
                             text-[10.5px] font-bold leading-4"
                  style={{
                    background: "var(--scan)",
                    color: "#04141a",
                    fontFamily: "var(--font-robomono), ui-monospace, monospace",
                  }}
                >
                  사람 {personIndex + 1}
                </span>
              </span>
            ))}

            {(harnessApplies ? (harnessByFrame[safeIndex]?.boxes ?? []) : []).map((box, boxIndex) => (
              <span
                key={`harness-${boxIndex}`}
                className="pointer-events-none absolute"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * HARNESS_CROP_BOTTOM * 100}%`,
                  // 사람 박스(실선)와 구분되게 점선으로 둔다. 다른 판정이고 다른 모델이다.
                  border: "2px dashed var(--scan)",
                }}
              >
                <span
                  className="absolute -bottom-[1.15rem] left-[-2px] whitespace-nowrap px-1 py-[1px]
                             text-[10.5px] font-bold leading-4"
                  style={{
                    background: "var(--scan)",
                    color: "#04141a",
                    fontFamily: "var(--font-robomono), ui-monospace, monospace",
                  }}
                >
                  {harnessLabel(box.status, box.confidence, box.hookStatus, box.hookConfidence)}
                </span>
              </span>
            ))}

            <span
              className="absolute right-2 top-2 flex flex-col items-end gap-1 text-[12px] font-bold"
            >
              <span
                className="rounded-sm px-2 py-1"
                style={{ background: "rgba(4, 20, 26, 0.82)", color: "var(--scan)" }}
              >
                {persons.length > 0 ? `${persons.length}명이 접근 중` : "접근 중인 사람 없음"}
              </span>
              {harnessApplies && harnessByFrame[safeIndex]?.verdict ? (
                <span
                  className="rounded-sm px-2 py-1"
                  style={{ background: "rgba(4, 20, 26, 0.82)", color: "var(--scan)" }}
                >
                  {harnessLabel(
                    harnessByFrame[safeIndex].verdict,
                    0,
                    harnessByFrame[safeIndex].hookVerdict,
                    0,
                  )}
                </span>
              ) : null}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-plate-rule px-3 py-2">
            <button
              type="button"
              className="btn-quiet btn-sm"
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
              disabled={safeIndex === 0}
            >
              이전 장면
            </button>
            <span className="scan">
              {safeIndex + 1} / {frameUrls.length} · T {formatClock(frame?.tSec ?? 0)}
            </span>
            <button
              type="button"
              className="btn-quiet btn-sm"
              onClick={() => setIndex((value) => Math.min(frameUrls.length - 1, value + 1))}
              disabled={safeIndex === frameUrls.length - 1}
            >
              다음 장면
            </button>
          </div>
        </div>

        <p className="text-[12.5px] leading-5 text-ink-3">
          {harnessApplies ? (
            <>
              실선은 사람, 점선은{" "}
              <strong className="font-bold text-ink-2">안전대 판정에 쓴 상체 영역</strong>입니다 —
              훅을 탐지한 박스가 아니라 그 영역을 보고 착용과 체결을 추정한 것입니다.{" "}
            </>
          ) : (
            <>박스는 탐지한 사람입니다. 이 구역은 끼임을 보므로 사람만 표시합니다. </>
          )}
          이전·다음 장면으로 선택한 이미지를 차례로 확인할 수 있습니다.
          {harnessApplies && harnessByFrame.length === 0
            ? " 안전대 판정은 수신함에서 «안전대 착용 판정» 을 눌러야 나옵니다."
            : ""}
        </p>
      </div>
    );
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    const video = videoRef.current;
    if (!video) return;
    const step = 1 / 6;
    const keys: Record<string, () => void> = {
      " ": () => (video.paused ? void video.play() : video.pause()),
      ArrowLeft: () => (video.currentTime = Math.max(0, video.currentTime - 1)),
      ArrowRight: () => (video.currentTime = Math.min(duration, video.currentTime + 1)),
      ",": () => (video.currentTime = Math.max(0, video.currentTime - step)),
      ".": () => (video.currentTime = Math.min(duration, video.currentTime + step)),
      Home: () => (video.currentTime = 0),
      n: () => seek(events.find((e) => e.startSec > video.currentTime + 0.1)?.startSec ?? video.currentTime),
      p: () =>
        seek([...events].reverse().find((e) => e.startSec < video.currentTime - 0.1)?.startSec ?? 0),
    };
    const handler = keys[event.key] ?? keys[event.key.toLowerCase()];
    if (handler) {
      event.preventDefault();
      handler();
    }
  }

  // 영상이 안 뜨면 캡처 정지 이미지로 물러난다. 심사 자리에서 검은 화면을 띄우지 않는다.
  if (broken || !videoPath) {
    return (
      <figure className="plate overflow-hidden">
        {posterPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posterPath} alt="분석 영상 대체 이미지" className="block w-full" />
        ) : null}
        <figcaption className="px-3 py-2 text-[12.5px]" style={{ color: "var(--plate-ink-2)" }}>
          영상을 재생할 수 없어 정지 화면으로 대신합니다. 아래 사건 목록의 근거 이미지는 그대로
          확인할 수 있습니다.
        </figcaption>
      </figure>
    );
  }

  return (
    <div
      className="flex flex-col gap-2"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label="분석 영상 재생기"
    >
      <div className="plate overflow-hidden">
        <div className="relative">
          <video
            ref={videoRef}
            src={videoPath}
            poster={posterPath || undefined}
            playsInline
            muted
            preload="metadata"
            controls
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setBroken(true)}
            className="block w-full"
          />

          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {zones.map((zone) => {
              const occupied = (occupancyByZone[zone.id] ?? 0) > 0;
              return (
                <polygon
                  key={zone.id}
                  points={polygonPoints(zone.polygon)}
                  vectorEffect="non-scaling-stroke"
                  style={{
                    // 위험이 커진 것은 농도로 말한다. 기계 층에 빨강은 쓰지 않는다.
                    fill: `color-mix(in srgb, var(--scan) ${occupied ? 28 : 10}%, transparent)`,
                    stroke: "var(--scan)",
                    strokeWidth: occupied ? 2 : 1,
                    strokeDasharray: occupied ? undefined : "0.012 0.008",
                  }}
                />
              );
            })}
          </svg>

          {current?.persons.map((person, i) => (
            <span
              key={`${person.trackId ?? "anon"}-${i}`}
              className="pointer-events-none absolute"
              style={{
                left: `${person.x * 100}%`,
                top: `${person.y * 100}%`,
                width: `${person.w * 100}%`,
                height: `${person.h * 100}%`,
                border: `${person.zoneIds.length > 0 ? 2 : 1}px solid var(--scan)`,
                opacity: person.zoneIds.length > 0 ? 1 : 0.45,
              }}
            >
              <span
                className="absolute -top-[1.15rem] left-[-2px] whitespace-nowrap px-1 py-[1px]
                           text-[10.5px] font-bold leading-4"
                style={{
                  background: "var(--scan)",
                  color: "#04141a",
                  fontFamily: "var(--font-robomono), ui-monospace, monospace",
                }}
              >
                {person.trackId != null ? `#${person.trackId}` : "person"}{" "}
                {person.confidence.toFixed(2)}
                {person.truncated ? " ~" : ""}
              </span>
            </span>
          ))}

          <span
            className="pointer-events-none absolute left-1 top-1 flex flex-wrap gap-x-3 px-1.5 py-[2px]
                       text-[10.5px] font-bold leading-4"
            style={{
              background: "rgba(4, 20, 26, 0.72)",
              color: "var(--scan)",
              fontFamily: "var(--font-robomono), ui-monospace, monospace",
            }}
          >
            <span>T {formatClock(current?.tSec ?? 0)}</span>
            {zones.map((zone) => (
              <span key={zone.id}>
                {zone.name} IN {occupancyByZone[zone.id] ?? 0} · DWELL{" "}
                {(dwellByZone[zone.id] ?? 0).toFixed(1)}s
              </span>
            ))}
          </span>
        </div>

        {/* 스크럽 트랙 — 어디를 봐야 하는지 한 줄로 말한다 */}
        <div className="relative h-8 border-t border-plate-rule px-2 py-1.5">
          <div className="relative h-full w-full" style={{ background: "var(--plate-2)" }}>
            {events.map((event) => {
              const left = (event.startSec / duration) * 100;
              const width = Math.max(0.8, ((event.endSec - event.startSec) / duration) * 100);
              // 레벨은 높이로도 구분한다. 색만으로 뜻을 전하지 않는다.
              const height = event.level === "CRITICAL" ? 100 : event.level === "WARNING" ? 66 : 40;
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => seek(event.startSec)}
                  aria-label={`${levelLabel(event.level)} 구간, ${Math.round(event.startSec)}초부터 ${Math.round(event.endSec)}초, ${riskCodeLabel(event.code)}`}
                  title={`${LEVEL_MARK[event.level]} ${riskCodeLabel(event.code)}`}
                  className="absolute bottom-0 cursor-pointer"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                    background: levelTone(event.level),
                    opacity: activeEventId === event.id ? 1 : 0.75,
                  }}
                />
              );
            })}
            <span
              aria-hidden
              className="absolute inset-y-0 w-px"
              style={{
                left: `${((current?.tSec ?? 0) / duration) * 100}%`,
                background: "var(--scan)",
              }}
            />
          </div>
        </div>
      </div>

      <details className="text-[12.5px] text-ink-3">
        <summary className="cursor-pointer">
          단축키 {playing ? "· 재생 중" : ""}
        </summary>
        <p className="mt-1.5 leading-6">
          <kbd className="num">Space</kbd> 재생/정지 · <kbd className="num">←/→</kbd> 1초 ·{" "}
          <kbd className="num">,/.</kbd> 한 프레임 · <kbd className="num">N/P</kbd> 다음/이전 위험
          구간 · <kbd className="num">Home</kbd> 처음으로. 재생기에 초점이 있어야 동작합니다.
        </p>
      </details>

      {events.length > 0 ? (
        <p className="text-[12.5px] text-ink-3">
          위험 구간 {events.length}개 · 가장 긴 잔류{" "}
          <span className="num">{formatDurationKo(Math.max(...events.map((e) => e.dwellSec)))}</span>
        </p>
      ) : null}
    </div>
  );
}
