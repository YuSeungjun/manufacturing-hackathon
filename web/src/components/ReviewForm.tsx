"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { reviewRiskEventAction, type ReviewState } from "@/app/actions/risk";

function Decide({ decision, label, tone }: { decision: string; label: string; tone: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="decision"
      value={decision}
      className={`btn-sm ${tone}`}
      disabled={pending}
    >
      {label}
    </button>
  );
}

/**
 * 사람의 판단.
 *
 * AI 는 여기까지 오지 않는다 — 근거를 만들어 놓고 멈춘다.
 *
 * **"위험 확정" 은 종결이 아니라 이송이다.** 사건이 진행 중인 사건으로 옮겨지고, 확정·패스는
 * 그 화면에서 내린다. 화면에서 "위험이다" 라고 누른 시점과 현장이 실제로 처리된 시점은
 * 다르고, 안전이행 점수는 후자에서만 움직인다.
 *
 * 옮긴 뒤에 물어보는 이유 — 목록에서 사라진 사건이 어디로 갔는지 모르면 관리자는 "지웠나?"
 * 하고 의심한다. 옮겼다고 말하고 갈지 물어보는 게 한 줄 더 쓰는 값을 한다.
 */
export function ReviewForm({
  riskEventId,
  status,
  comment,
  cleared = false,
}: {
  riskEventId: string;
  status: string;
  comment: string;
  /** 구역이 비었는가(clearedAt). 사람이 나간 뒤라면 지금 판단해도 늦지 않다. */
  cleared?: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState<ReviewState, FormData>(reviewRiskEventAction, null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const decided = status !== "PENDING";

  const moved = state != null && "ok" in state && state.movedToIncidents;

  useEffect(() => {
    if (!moved) return;
    // showModal 은 브라우저가 포커스와 Esc 를 알아서 처리한다. 직접 만들 이유가 없다.
    dialogRef.current?.showModal();
  }, [moved]);

  return (
    <>
      <form action={action} className="flex flex-col gap-2 border-t border-rule-soft pt-2.5">
        <input type="hidden" name="riskEventId" value={riskEventId} />
        <label className="flex flex-col gap-1">
          <span className="sr-only">판단 메모</span>
          <input
            name="comment"
            className="input py-1.5 text-[13px]"
            placeholder="현장 확인 내용 (선택)"
            defaultValue={comment}
            maxLength={500}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Decide
            decision="CONFIRMED"
            label={decided ? "위험 확정으로 변경" : "위험 확정"}
            tone="btn-deny"
          />
          <Decide decision="FALSE_POSITIVE" label="오탐" tone="btn-quiet" />
          <Decide decision="HOLD" label="보류" tone="btn-quiet" />
        </div>

        <p className="text-[12px] leading-5 text-ink-3">
          위험 확정은 종결이 아닙니다 — 사건이{" "}
          <strong className="font-bold text-ink-2">진행 중인 사건</strong>으로 옮겨지고, 확정·패스는
          그 화면에서 내립니다.
          {cleared ? " 이 구역은 현재 비어 있습니다." : ""}
        </p>

        {state && "error" in state ? (
          <p className="text-[12.5px] font-bold" style={{ color: "var(--deny)" }} role="alert">
            {state.error}
          </p>
        ) : null}
        {state && "ok" in state && !state.movedToIncidents ? (
          <p className="text-[12.5px] font-bold" style={{ color: "var(--safe)" }} role="status">
            {state.message}
          </p>
        ) : null}
      </form>

      <dialog
        ref={dialogRef}
        className="paper max-w-[24rem] p-0 backdrop:bg-black/45"
        onClose={() => router.refresh()}
      >
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[14.5px] font-bold">진행 중인 사건으로 옮겼습니다</p>
          <p className="text-[13px] leading-6 text-ink-2">
            이 사건은 이제 검토 대기 목록에 없습니다. 진행 중인 사건 화면에서 현장 확인 후{" "}
            <strong className="font-bold text-ink">확정</strong> 또는{" "}
            <strong className="font-bold text-ink">패스</strong>로 종결합니다.
            <br />
            그 페이지로 바로 가시겠습니까?
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="btn-quiet btn-sm"
              onClick={() => dialogRef.current?.close()}
            >
              여기 있기
            </button>
            <button
              type="button"
              className="btn-act btn-sm"
              onClick={() => {
                dialogRef.current?.close();
                router.push("/manager/incidents");
              }}
            >
              진행 중인 사건으로 이동
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
