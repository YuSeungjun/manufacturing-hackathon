"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestRestartAction, confirmRestartedAction, type RestartState } from "@/app/actions/restart";
import { InterlockBadge } from "@/components/ui";

function RequestButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={blocked ? "btn-quiet" : "btn-act"} disabled={pending}>
      {pending ? "확인 중…" : "재가동 요청"}
    </button>
  );
}

/**
 * 운전석 패널.
 *
 * 이 버튼 하나가 이 프로젝트의 전부다. 누르면 시스템이 위험구역을 먼저 확인하고,
 * 사람이 남아 있으면 재가동을 막은 뒤 근거를 보여 준다.
 */
export function RestartPanel({
  equipmentId,
  equipmentName,
  interlock,
  interlockReason,
  runState,
}: {
  equipmentId: string;
  equipmentName: string;
  interlock: string;
  interlockReason: string;
  runState: string;
}) {
  const [state, action] = useActionState<RestartState, FormData>(requestRestartAction, null);
  const blocked = interlock === "BLOCKED";

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-2.5">
        <input type="hidden" name="equipmentId" value={equipmentId} />
        <label className="flex flex-col gap-1">
          <span className="label">재가동 사유</span>
          <input
            name="reason"
            className="input py-1.5 text-[13px]"
            placeholder="예: 롤 교체 완료, 라인 재개 필요"
            maxLength={300}
          />
        </label>
        <div className="flex items-center gap-2">
          <RequestButton blocked={blocked} />
          {runState === "RUNNING" ? (
            <span className="text-[12.5px] text-ink-3">이미 가동 중입니다.</span>
          ) : null}
        </div>
      </form>

      {state && "error" in state ? (
        <p className="text-[13px] font-bold" style={{ color: "var(--deny)" }} role="alert">
          {state.error}
        </p>
      ) : null}

      {state && "ok" in state && state.decision === "BLOCKED" ? (
        <div
          className="flex flex-col gap-2 rounded-md px-3.5 py-3"
          style={{
            border: "2px solid var(--deny)",
            background: "var(--deny-soft)",
          }}
          role="alert"
        >
          <p className="flex items-center gap-2 text-[15px] font-extrabold" style={{ color: "var(--deny)" }}>
            <span aria-hidden>⛔</span> 재가동이 차단되었습니다
          </p>
          <p className="text-[13.5px] leading-6 text-ink">{state.reason}</p>
          {state.lotoHolders.length > 0 ? (
            <p className="text-[13px] text-ink-2">
              미해제 시건:{" "}
              {state.lotoHolders.map((h) => `${h.name}(${h.employeeNumber})`).join(", ")}
            </p>
          ) : null}
          <p className="text-[12.5px] text-ink-3">
            위험 사건을 조치하고 개인 시건을 모두 해제한 뒤 다시 요청해 주세요.
          </p>
        </div>
      ) : null}

      {state && "ok" in state && state.decision === "ALLOWED" ? (
        <div className="flex flex-col gap-2 rounded-md px-3.5 py-3"
          style={{ border: "2px solid var(--safe)", background: "var(--safe-soft)" }}
          role="status"
        >
          <p className="flex items-center gap-2 text-[15px] font-extrabold" style={{ color: "var(--safe)" }}>
            <span aria-hidden>✓</span> 재가동 가능
          </p>
          <p className="text-[13.5px] leading-6 text-ink">{state.reason}</p>
          <form action={confirmRestartedAction}>
            <input type="hidden" name="requestId" value={state.requestId} />
            <button type="submit" className="btn-safe btn-sm">
              {equipmentName} 재가동
            </button>
          </form>
        </div>
      ) : null}

      {!state && blocked ? (
        <div className="flex flex-wrap items-center gap-2">
          <InterlockBadge interlock={interlock} />
          <span className="text-[12.5px] text-ink-3">{interlockReason}</span>
        </div>
      ) : null}
    </div>
  );
}
