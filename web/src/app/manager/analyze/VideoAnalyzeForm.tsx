"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import { startVideoAnalysisAction } from "@/app/actions/analysis";
import { persistAnalysisResultAction } from "@/app/actions/analysis";
import { MACHINE_STATE_LABEL } from "@/lib/zone";

type EquipmentOption = {
  id: string;
  code: string;
  name: string;
  zoneCount: number;
};

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "analyzing"; percent: number; processed: number; total: number }
  | { kind: "error"; message: string };

/**
 * CCTV 영상 분석.
 *
 * 영상은 브라우저에서 Blob 으로 바로 올라간다 — Vercel Function 요청 본문 4.5MB 한도를
 * 지나가지 않기 위해서다. 서버 액션에는 URL 만 넘어간다.
 *
 * 분석은 잡+폴링이라 진행률이 보인다. 20초짜리 클립도 CPU 에서 십수 초가 걸리는데,
 * 그동안 화면이 멈춰 있으면 데모에서 죽은 것처럼 보인다.
 */
export function VideoAnalyzeForm({ equipment }: { equipment: EquipmentOption[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [fileName, setFileName] = useState("");
  const [restartAt, setRestartAt] = useState("");
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = phase.kind === "uploading" || phase.kind === "analyzing" || pending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setPhase({ kind: "error", message: "분석할 영상을 선택해 주세요." });
      return;
    }

    let videoUrl: string;
    try {
      setPhase({ kind: "uploading", percent: 0 });
      const blob = await upload(`clips/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        onUploadProgress: ({ percentage }) => setPhase({ kind: "uploading", percent: percentage }),
      });
      videoUrl = blob.url;
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "영상을 올리지 못했습니다.",
      });
      return;
    }

    const data = new FormData(form);
    data.set("videoUrl", videoUrl);

    const started = await startVideoAnalysisAction(null, data);
    if (!started || "error" in started) {
      setPhase({ kind: "error", message: started?.error ?? "분석을 시작하지 못했습니다." });
      return;
    }

    setPhase({ kind: "analyzing", percent: 0, processed: 0, total: 0 });
    await poll(started.analysisId, started.jobId);
  }

  async function poll(analysisId: string, jobId: string) {
    // 폴링은 라우트 핸들러로 한다. 서버 액션은 진행 상황을 흘려보낼 수 없다.
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      let job: { status: string; progress: number; processedFrames: number; totalFrames: number; error?: string };
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
        total: job.totalFrames ?? 0,
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

  return (
    <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div className="paper flex flex-col gap-4 p-4">
        <label className="flex flex-col gap-1.5">
          <span className="label">설비</span>
          <select name="equipmentId" className="input" required defaultValue="">
            <option value="" disabled>
              설비를 고르세요
            </option>
            {equipment.map((item) => (
              <option key={item.id} value={item.id} disabled={item.zoneCount === 0}>
                {item.code} {item.name}
                {item.zoneCount === 0 ? " — 위험구역 없음" : ` · 구역 ${item.zoneCount}개`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="label">CCTV 영상</span>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="input"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            required
          />
          <span className="text-[12px] text-ink-3">
            {fileName ? `${fileName} 선택됨 · ` : ""}20초 이내 클립을 권장합니다. 60초를 넘으면 앞
            60초만 분석합니다.
          </span>
        </label>

        <fieldset className="flex flex-col gap-2.5 rounded-md border border-rule px-3 py-3">
          <legend className="label px-1">설비 상태</legend>
          <p className="text-[12.5px] leading-5 text-ink-3">
            실제 현장에서는 PLC·LOTO 시건 시스템이 이 값을 줍니다. 데모에서는 여기서 넣습니다 —
            <strong className="font-bold text-ink-2"> 끼임은 사람이 들어간 순간이 아니라 안에 있는 채로 설비가 깨어난 순간</strong>
            에 일어나기 때문에, 그 시각이 판정에 반드시 필요합니다.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="label">영상 시작 시점</span>
              <select name="initialState" className="input" defaultValue="STOPPED">
                {["STOPPED", "LOTO", "RUNNING"].map((s) => (
                  <option key={s} value={s}>
                    {MACHINE_STATE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">재가동 시각 (초)</span>
              <input
                name="restartAtSec"
                type="number"
                step="0.5"
                min="0"
                className="input num"
                placeholder="비우면 재가동 없음"
                value={restartAt}
                onChange={(e) => setRestartAt(e.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          <button type="submit" className="btn-act" disabled={busy}>
            {busy ? "분석 중…" : "분석 시작"}
          </button>
        </div>
      </div>

      <div className="plate flex flex-col gap-3 p-4">
        <p className="scan">분석 진행</p>
        {phase.kind === "idle" ? (
          <p className="text-[13px] leading-6" style={{ color: "var(--plate-ink-2)" }}>
            영상을 올리면 프레임마다 작업자를 찾아 위험구역 잔류를 재고, 설비 상태와 겹치는
            순간을 잘라 냅니다.
          </p>
        ) : null}

        {phase.kind === "uploading" ? (
          <Progress label="영상 업로드" percent={phase.percent} detail={`${Math.round(phase.percent)}%`} />
        ) : null}

        {phase.kind === "analyzing" ? (
          <Progress
            label="AI 분석"
            percent={phase.percent}
            detail={phase.total > 0 ? `${phase.processed} / ${phase.total} 프레임` : "준비 중"}
          />
        ) : null}

        {pending ? (
          <p className="scan" style={{ color: "var(--scan)" }}>
            결과 저장 중…
          </p>
        ) : null}

        {phase.kind === "error" ? (
          <p className="text-[13px] font-bold" style={{ color: "var(--deny)" }} role="alert">
            {phase.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function Progress({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-bold" style={{ color: "var(--plate-ink)" }}>
          {label}
        </span>
        <span className="scan">{detail}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden"
        style={{ background: "var(--plate-2)" }}
      >
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${Math.max(2, percent)}%`, background: "var(--scan)" }}
        />
      </div>
    </div>
  );
}
