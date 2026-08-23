"use client";

import { useFormStatus } from "react-dom";
import { reviewRiskEventAction } from "@/app/actions/risk";

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
 * 빨강은 사람이 위험으로 확정한 뒤에만 나타난다.
 */
export function ReviewForm({
  riskEventId,
  status,
  comment,
}: {
  riskEventId: string;
  status: string;
  comment: string;
}) {
  const decided = status !== "PENDING";

  return (
    <form action={reviewRiskEventAction} className="flex flex-col gap-2 border-t border-rule-soft pt-2.5">
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
        <Decide decision="CONFIRMED" label={decided ? "위험 확정으로 변경" : "위험 확정"} tone="btn-deny" />
        <Decide decision="FALSE_POSITIVE" label="오탐" tone="btn-quiet" />
        <Decide decision="HOLD" label="보류" tone="btn-quiet" />
      </div>
      {decided ? (
        <p className="text-[12px] text-ink-3">
          판단을 바꿔도 설비 인터록은 자동으로 풀리지 않습니다. 해제는 재가동 승인 화면에서 합니다.
        </p>
      ) : null}
    </form>
  );
}
