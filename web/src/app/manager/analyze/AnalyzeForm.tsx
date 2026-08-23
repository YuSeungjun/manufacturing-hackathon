"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { analyzeFrameAction, type AnalyzeState } from "@/app/actions/detection";
import { ppeLabel } from "@/lib/ppe";

type TbmOption = { id: string; label: string; workArea: string; aiRules: string[] };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-act w-full" disabled={pending}>
      {pending ? "이미지를 분석하는 중…" : "AI 분석 실행"}
    </button>
  );
}

export function AnalyzeForm({ tbms }: { tbms: TbmOption[] }) {
  const [state, formAction] = useActionState<AnalyzeState, FormData>(analyzeFrameAction, null);
  const [tbmId, setTbmId] = useState(tbms[0]?.id ?? "");
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const selected = tbms.find((tbm) => tbm.id === tbmId);
  const result = state && "ok" in state ? state : null;

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
      {/* 사람이 채우는 쪽 — 종이 서식. */}
      <form action={formAction} className="paper space-y-4">
        <div>
          <label className="label" htmlFor="tbmId">
            분석 대상 TBM
          </label>
          <select
            id="tbmId"
            name="tbmId"
            className="input"
            value={tbmId}
            onChange={(event) => setTbmId(event.target.value)}
          >
            {tbms.map((tbm) => (
              <option key={tbm.id} value={tbm.id}>
                {tbm.label}
              </option>
            ))}
          </select>
          {selected ? (
            <p className="mt-2 text-[12.5px] leading-6 text-ink-2">
              <span className="font-bold text-ink-3">AI가 확인할 수칙</span>{" "}
              {selected.aiRules.length > 0 ? (
                selected.aiRules.join(", ")
              ) : (
                <span style={{ color: "var(--hold)" }}>
                  없음 — TBM에서 보호구 항목을 AI 확인으로 지정해 주세요
                </span>
              )}
            </p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="location">
            촬영 위치
          </label>
          <input
            id="location"
            name="location"
            className="input"
            defaultValue={selected?.workArea ?? ""}
            key={selected?.workArea}
          />
        </div>

        <div>
          <label className="label" htmlFor="frame">
            CCTV 캡처 이미지
          </label>
          {/* 기본 파일 입력은 폭이 제멋대로라 라벨을 눌러 여는 형태로 바꿨다. */}
          <label
            htmlFor="frame"
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-dashed
                       border-rule bg-paper-2 px-3 py-2.5 text-[14px] transition-colors hover:border-act"
          >
            <span className="btn-quiet btn-sm pointer-events-none">이미지 선택</span>
            <span className="min-w-0 flex-1 truncate text-ink-3">{fileName ?? "선택된 파일 없음"}</span>
          </label>
          <input
            id="frame"
            name="frame"
            type="file"
            accept="image/*"
            required
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setFileName(file?.name ?? null);
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
          />
        </div>

        <div>
          <label className="label" htmlFor="conf">
            탐지 민감도
          </label>
          <select id="conf" name="conf" className="input" defaultValue="0.35">
            <option value="0.35">표준 — 권장</option>
            <option value="0.25">민감하게 — 놓치는 건을 줄입니다</option>
            <option value="0.5">엄격하게 — 확실한 건만 올립니다</option>
          </select>
        </div>

        <SubmitButton />

        {state && "error" in state ? (
          <p
            role="alert"
            className="rounded-md border px-3 py-2.5 text-[13px] leading-6"
            style={{ borderColor: "var(--deny)", background: "var(--deny-soft)", color: "var(--deny)" }}
          >
            {state.error}
          </p>
        ) : null}
      </form>

      {/* 기계가 답하는 쪽 — 모니터 판. */}
      <div>
        <div className="plate p-3">
          <p className="scan mb-2">분석 결과</p>
          {result ? (
            <>
              {/* 분석 결과 이미지는 로컬 파일이라 최적화 없이 그대로 띄운다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.evidencePath} alt="탐지 결과가 표시된 현장 이미지" className="block w-full" />
              <p className="scan mt-2">
                DETECTED {result.created} · UNLISTED {result.unlistedCodes.length}
              </p>
            </>
          ) : preview ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="선택한 이미지 미리보기" className="block w-full opacity-60" />
              <p className="scan mt-2 opacity-70">STANDBY · 아직 분석 전</p>
            </>
          ) : (
            <p className="py-10 text-center text-[13px]" style={{ color: "var(--plate-ink-2)" }}>
              이미지를 선택하고 분석을 실행하면 결과가 여기에 표시됩니다.
            </p>
          )}
        </div>

        {result ? (
          <div className="paper mt-3">
            <p className="text-[14px] leading-6">{result.message}</p>
            {result.unlistedCodes.length > 0 ? (
              <p className="mt-1.5 text-[13px] leading-6 text-ink-2">
                <span className="font-bold text-ink-3">TBM에 없는 항목</span>{" "}
                {result.unlistedCodes.map(ppeLabel).join(", ")}
              </p>
            ) : null}
            {result.created > 0 ? (
              <Link href="/manager/detections" className="btn-act mt-3 w-full">
                검토 화면에서 판단하기 →
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-[13px] leading-6 text-ink-2">
            탐지된 항목은 바로 감점되지 않습니다. 검토 대기로 올라가고, 안전관리자가 확정한 건만
            점수에 반영됩니다.
          </p>
        )}
      </div>
    </div>
  );
}
