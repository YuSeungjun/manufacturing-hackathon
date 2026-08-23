"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { analyzeHarnessAction, analyzeSnapshotsAction } from "@/app/actions/snapshots";
import { persistAnalysisResultAction } from "@/app/actions/analysis";
import type { TrackBox, ZonePoint } from "@/lib/zone";

export type SnapshotItem = {
  id: string;
  imagePath: string;
  /** 서버가 현장 시간대로 포맷한 문자열. 클라이언트에서 다시 만들면 시간대가 어긋난다. */
  capturedLabel: string;
  capturedAtMs: number;
  trigger: string;
  note: string;
  cameraId: string;
  cameraCode: string;
  cameraName: string;
  equipmentCode: string | null;
  equipmentName: string | null;
  analysisId: string | null;

  /** 수신 시점 1차 탐지 */
  personCount: number;
  boxes: TrackBox[];
  zoneOccupancy: Record<string, number>;
  /** false 면 탐지를 못 돌린 장면이다 — "사람이 없었다" 와 다르다 */
  detected: boolean;
  zones: { id: string; name: string; polygon: ZonePoint[] }[];

  /** 안전대 착용 판정 (별도 버튼). "" 면 아직 안 돌린 장면이다. */
  harnessVerdict: string;
  harnessConfidence: number;
  harnessProvider: string;
  /** 훅 체결 판정. 착용이 확인된 장면에만 값이 있다. */
  hookVerdict: string;
  hookConfidence: number;
};

/**
 * 안전대 판정 배지.
 *
 * 미착용도 빨강(deny)이 아니다 — 기계가 본 사실이고 위반 확정이 아니다. 강조(act)까지.
 * 판정 결과는 1차 탐지 오버레이와 달리 항상 보인다: 저장된 판정값이라 "눌러서 보는 것"
 * 이 아니라 그 장면에 이미 붙어 있는 사실이다.
 */
const HARNESS_BADGE: Record<string, { label: string; tone: string }> = {
  WORN: { label: "안전대 착용", tone: "tag-safe" },
  NOT_WORN: { label: "안전대 미착용 의심", tone: "tag-act" },
  UNKNOWN: { label: "안전대 판정 불가", tone: "tag-hold" },
};

/**
 * 훅 체결 배지.
 *
 * 착용과 따로 보여준다. "하네스는 입었는데 훅을 안 걸었다" 가 추락에서 실제로 사람이
 * 죽는 상태이고, 그걸 "안전대 착용" 한 줄로 덮으면 가장 중요한 걸 가리는 것이다.
 */
const HOOK_BADGE: Record<string, { label: string; tone: string }> = {
  ATTACHED: { label: "훅 체결", tone: "tag-safe" },
  NOT_ATTACHED: { label: "훅 미체결 의심", tone: "tag-act" },
  UNKNOWN: { label: "훅 판정 불가", tone: "tag-hold" },
};

export const TRIGGER_LABEL: Record<string, string> = {
  ZONE_APPROACH: "위험구역 접근",
  MOTION: "움직임 감지",
  SCHEDULE: "주기 촬영",
  MANUAL: "수동 등록",
};

/**
 * 수신 장면 한 장.
 *
 * 분석 전에는 원본만 보여 준다. 분석을 눌러야 사람 박스와 접근 인원이 나타나며, 위험구역
 * 폴리곤은 이 선택 화면에 그리지 않는다. 사용자가 찾으려는 대상이 사람인지 구역인지 한눈에
 * 구분되도록 결과 오버레이를 사람 박스로만 제한한다.
 */
function SnapshotFrame({
  snapshot,
  order,
  showDetection,
}: {
  snapshot: SnapshotItem;
  order: number;
  showDetection: boolean;
}) {
  return (
    <span className="relative block overflow-hidden rounded-[3px]">
      <Image
        src={snapshot.imagePath}
        alt={`${snapshot.cameraName} ${snapshot.capturedLabel}`}
        width={480}
        height={360}
        unoptimized
        className="block h-auto w-full"
      />

      {showDetection
        ? snapshot.boxes.map((box, index) => (
            <span
              key={index}
              className="pointer-events-none absolute"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
                border: "2px solid var(--scan)",
              }}
            >
              <span
                className="absolute -top-[1.05rem] left-[-2px] whitespace-nowrap px-1 py-[1px]
                           text-[10px] font-bold leading-4 tracking-[0.02em]"
                style={{
                  background: "var(--scan)",
                  color: "#04141a",
                  fontFamily: "var(--font-robomono), ui-monospace, monospace",
                }}
              >
                사람 {index + 1}
              </span>
            </span>
          ))
        : null}

      {order >= 0 ? (
        <span
          className="num absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold"
          style={{ background: "var(--act)", color: "#fff" }}
        >
          {order + 1}
        </span>
      ) : null}

      {snapshot.harnessVerdict ? (
        <span className="absolute bottom-1.5 left-1.5 flex flex-wrap items-center gap-1">
          <span className={`tag ${HARNESS_BADGE[snapshot.harnessVerdict]?.tone ?? ""}`}>
            {HARNESS_BADGE[snapshot.harnessVerdict]?.label ?? snapshot.harnessVerdict}
            {snapshot.harnessConfidence > 0 ? (
              <span className="num ml-1 opacity-70">
                {Math.round(snapshot.harnessConfidence * 100)}%
              </span>
            ) : null}
          </span>
          {/* 착용이 확인된 장면에만 훅 배지가 붙는다. 하네스가 없으면 훅도 없다. */}
          {snapshot.harnessVerdict === "WORN" && snapshot.hookVerdict ? (
            <span className={`tag ${HOOK_BADGE[snapshot.hookVerdict]?.tone ?? ""}`}>
              {HOOK_BADGE[snapshot.hookVerdict]?.label ?? snapshot.hookVerdict}
              {snapshot.hookConfidence > 0 ? (
                <span className="num ml-1 opacity-70">
                  {Math.round(snapshot.hookConfidence * 100)}%
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      ) : null}

      {showDetection ? (
        <span className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">
          {!snapshot.detected ? (
            <span className="tag tag-hold">사람 탐지 실패</span>
          ) : snapshot.personCount > 0 ? (
            <span className="tag tag-act">{snapshot.personCount}명이 접근 중</span>
          ) : (
            <span className="tag">접근 중인 사람 없음</span>
          )}
        </span>
      ) : null}
    </span>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "analyzing"; percent: number; processed: number; total: number }
  | { kind: "error"; message: string };

function gapLabel(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `+${seconds}초`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `+${m}분` : `+${m}분 ${s}초`;
}

/**
 * 스냅샷 수신함.
 *
 * 안전관리자는 자기 컴퓨터에서 사진을 올리는 사람이 아니다. **카메라가 이미 찍어 둔 장면
 * 중에서 볼 것을 고르는** 사람이다. 그래서 이 화면에 파일 선택 대화상자가 없다.
 *
 * 고르는 것 외에 사람이 넣는 값이 없다 — 촬영 시각은 장면에 붙어 있고, 위험구역은 설비에
 * 그려져 있다. 설비 상태만 데모에서 받는데, 그것도 실운영에서는 PLC 가 준다.
 */
export function SnapshotInbox({
  snapshots,
  purpose,
}: {
  snapshots: SnapshotItem[];
  /**
   * 이 수신함이 무엇을 보는 구역인가. 버튼이 이걸로 갈린다.
   *
   * 탭을 구역 종류로 나눈 이유가 이것이다 — 컨베이어 탭에 안전대 버튼을 두면 관리자가
   * 끼임 장면에 안전대 판정을 돌리게 되고, 그 결과는 볼 이유가 없는 값이다.
   */
  purpose: "PINCH" | "FALL";
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [revealed, setRevealed] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  // 안전대는 별도 버튼이라 상태도 따로 둔다. 한쪽 실패가 다른 쪽 화면을 덮으면 안 된다.
  const [harnessBusy, setHarnessBusy] = useState(false);
  const [harnessMessage, setHarnessMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );

  const busy = phase.kind === "analyzing" || pending || harnessBusy;

  // 선택 순서가 아니라 촬영 순서로 정렬한다. 시퀀스는 시간이 정하는 것이다.
  const chosen = useMemo(
    () =>
      snapshots
        .filter((s) => selected.includes(s.id))
        .sort((a, b) => a.capturedAtMs - b.capturedAtMs),
    [snapshots, selected],
  );

  const cameraMix = new Set(chosen.map((s) => s.cameraId)).size > 1;
  const span = chosen.length > 1 ? chosen[chosen.length - 1].capturedAtMs - chosen[0].capturedAtMs : 0;
  const gaps = chosen.slice(1).map((s, i) => s.capturedAtMs - chosen[i].capturedAtMs);
  const minGap = gaps.length > 0 ? Math.min(...gaps) : 0;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  function selectCameraRun(cameraId: string) {
    setSelected(snapshots.filter((s) => s.cameraId === cameraId).map((s) => s.id));
  }

  async function analyze() {
    if (chosen.length === 0) return;
    // 분석 버튼을 누른 장면에만 1차 탐지 결과를 공개한다. 페이지에 들어온 직후에는 원본이다.
    setRevealed((previous) => [...new Set([...previous, ...chosen.map((s) => s.id)])]);
    // 설비 상태는 화면에서 받지 않는다. 설비 기록(runState·LOTO)에서 읽는다 —
    // 실운영에서 PLC 가 주는 값이라 사람이 고를 자리가 아니다.
    const data = new FormData();
    data.set("snapshotIds", JSON.stringify(chosen.map((s) => s.id)));

    const started = await analyzeSnapshotsAction(null, data);
    if (!started || "error" in started) {
      setPhase({ kind: "error", message: started?.error ?? "분석을 시작하지 못했습니다." });
      return;
    }
    setPhase({ kind: "analyzing", percent: 0, processed: 0, total: started.frameCount });
    await poll(started.analysisId, started.jobId, started.frameCount);
  }

  /**
   * 안전대 착용 판정.
   *
   * 위험구역 분석과 별도 버튼인 이유는 질문이 다르고 공급자가 다르기 때문이다. 진입·잔류는
   * 우리 로직이고, 안전대는 남의 학습 결과(Roboflow 호스팅 추론)에 의존한다. 한 버튼에
   * 묶으면 남의 서비스가 죽는 날 우리 판정까지 같이 의심받는다.
   */
  async function runHarness() {
    if (chosen.length === 0) return;
    setHarnessBusy(true);
    setHarnessMessage(null);
    const data = new FormData();
    data.set("snapshotIds", JSON.stringify(chosen.map((s) => s.id)));
    const result = await analyzeHarnessAction(null, data);
    setHarnessBusy(false);
    if (!result || "error" in result) {
      setHarnessMessage({ tone: "error", text: result?.error ?? "안전대 판정에 실패했습니다." });
      return;
    }
    setHarnessMessage({ tone: "ok", text: result.message });
    router.refresh();
  }

  async function poll(analysisId: string, jobId: string, total: number) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      let job: {
        status: string;
        progress: number;
        processedFrames: number;
        totalFrames: number;
        error?: string;
      };
      try {
        const response = await fetch(`/api/ai/jobs/${jobId}`, { cache: "no-store" });
        job = await response.json();
      } catch {
        continue; // 한 번 실패했다고 포기하지 않는다
      }

      if (job.status === "ERROR") {
        setPhase({ kind: "error", message: job.error ?? "분석에 실패했습니다." });
        return;
      }
      setPhase({
        kind: "analyzing",
        percent: Math.round((job.progress ?? 0) * 100),
        processed: job.processedFrames ?? 0,
        total: job.totalFrames || total,
      });

      if (job.status === "DONE") {
        startTransition(async () => {
          const saved = await persistAnalysisResultAction(analysisId);
          if (saved.status === "ERROR") {
            setPhase({ kind: "error", message: saved.error });
            return;
          }
          router.push(`/manager/analysis/${analysisId}`);
        });
        return;
      }
    }
    setPhase({ kind: "error", message: "분석이 예상보다 오래 걸립니다. 잠시 후 다시 시도해 주세요." });
  }

  const cameras = [...new Map(snapshots.map((s) => [s.cameraId, s])).values()];

  return (
    <div className="flex flex-col gap-4">
      {cameras.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">카메라별 한 번에 고르기</span>
          {cameras.map((s) => (
            <button
              key={s.cameraId}
              type="button"
              className="btn-quiet btn-sm"
              onClick={() => selectCameraRun(s.cameraId)}
            >
              {s.cameraName}
            </button>
          ))}
          <button type="button" className="btn-quiet btn-sm" onClick={() => setSelected([])}>
            선택 해제
          </button>
        </div>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {snapshots.map((snapshot, index) => {
          const on = selected.includes(snapshot.id);
          const order = chosen.findIndex((s) => s.id === snapshot.id);
          const previous = snapshots[index - 1];
          const sameCamera = previous?.cameraId === snapshot.cameraId;
          return (
            <li key={snapshot.id}>
              <label
                className="paper flex cursor-pointer flex-col gap-2 p-2.5 transition-colors"
                style={{
                  outline: on ? "2px solid var(--act)" : undefined,
                  outlineOffset: on ? "-2px" : undefined,
                }}
              >
                <SnapshotFrame
                  snapshot={snapshot}
                  order={order}
                  showDetection={revealed.includes(snapshot.id)}
                />

                <span className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(snapshot.id)}
                    disabled={busy}
                    className="mt-0.5"
                    aria-label={`${snapshot.capturedLabel} 장면 선택`}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="num text-[13px] font-bold">{snapshot.capturedLabel}</span>
                    <span className="text-[12px] text-ink-3">
                      {snapshot.cameraName}
                      {snapshot.equipmentCode ? ` · ${snapshot.equipmentCode}` : ""}
                    </span>
                    <span className="text-[12px] text-ink-2">
                      {TRIGGER_LABEL[snapshot.trigger] ?? snapshot.trigger}
                      {previous && sameCamera
                        ? ` · ${gapLabel(snapshot.capturedAtMs - previous.capturedAtMs)}`
                        : ""}
                    </span>
                    {snapshot.note ? (
                      <span className="text-[12px] text-ink-3">{snapshot.note}</span>
                    ) : null}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {chosen.length > 0 ? (
        <div
          className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-md p-4"
          style={{ border: "2px solid var(--act)", background: "var(--paper)" }}
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-[14px] font-bold">
              {chosen.length}장 선택 — {chosen[0].cameraName}
            </p>
            {chosen.length > 1 ? (
              <p className="num text-[12.5px] text-ink-3">
                구간 {gapLabel(span)} · 최소 간격 {gapLabel(minGap)}
              </p>
            ) : null}
          </div>

          {/* 카메라가 섞이면 좌표계가 달라 판정이 무의미하다. 이건 설명이 아니라 차단 사유라 남긴다. */}
          {cameraMix ? (
            <p className="text-[12.5px] font-bold" style={{ color: "var(--deny)" }}>
              카메라가 섞여 있습니다. 위험구역은 화각마다 다르므로 한 카메라만 고르세요.
            </p>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            <span className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-act"
                onClick={analyze}
                disabled={busy || cameraMix}
              >
                {phase.kind === "analyzing" || pending
                  ? "분석 중…"
                  : `위험구역 분석 ${chosen.length}장`}
              </button>
              {/* 안전대는 추락 위험 구역 탭에서만 묻는다. */}
              {purpose === "FALL" ? (
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={runHarness}
                  disabled={busy}
                  title="사람을 찾아 상체만 잘라 안전대 착용과 훅 체결을 추정합니다. 확정은 사람이 합니다."
                >
                  {harnessBusy ? "판정 중…" : `안전대 착용 판정 ${chosen.length}장`}
                </button>
              ) : null}
            </span>
          </div>

          {harnessMessage ? (
            <p
              className="text-[13px] font-bold"
              style={{ color: harnessMessage.tone === "ok" ? "var(--safe)" : "var(--deny)" }}
              role={harnessMessage.tone === "ok" ? "status" : "alert"}
            >
              {harnessMessage.text}
            </p>
          ) : null}

          {phase.kind === "analyzing" ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-bold">AI 분석</span>
                <span className="num text-[12.5px] text-ink-3">
                  {phase.processed} / {phase.total}장
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={phase.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="AI 분석"
                className="h-1.5 w-full overflow-hidden rounded-[1px]"
                style={{ background: "var(--rule-soft)" }}
              >
                <div
                  className="h-full transition-[width] duration-300"
                  style={{ width: `${Math.max(2, phase.percent)}%`, background: "var(--act)" }}
                />
              </div>
            </div>
          ) : null}

          {pending ? <p className="text-[12.5px] text-ink-3">결과 저장 중…</p> : null}

          {phase.kind === "error" ? (
            <p className="text-[13px] font-bold" style={{ color: "var(--deny)" }} role="alert">
              {phase.message}
            </p>
          ) : null}

          {chosen[0].analysisId ? (
            <p className="text-[12px] text-ink-3">
              이 장면들은 전에 분석에 쓰였습니다.{" "}
              <Link
                href={`/manager/analysis/${chosen[0].analysisId}`}
                className="font-bold text-act underline"
              >
                지난 결과 보기
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
