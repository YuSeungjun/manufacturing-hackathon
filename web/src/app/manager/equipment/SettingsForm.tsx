"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateEquipmentSettingsAction, type EquipmentState } from "@/app/actions/equipment";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-quiet btn-sm" disabled={pending}>
      {pending ? "저장 중…" : "저장"}
    </button>
  );
}

/**
 * 설비 종류와 분당 손실단가.
 *
 * 단가는 비워 둘 수 있다. 비면 반복 패턴 화면에서 금액 칸이 사라지고 횟수와 시간만 남는다.
 * 그게 기본값이어야 한다 — 없는 숫자를 채워 넣는 것보다 비어 있는 게 정직하다.
 */
export function SettingsForm({
  equipmentId,
  kind,
  downtimeCostPerMin,
}: {
  equipmentId: string;
  kind: string;
  downtimeCostPerMin: number;
}) {
  const [state, action] = useActionState<EquipmentState, FormData>(
    updateEquipmentSettingsAction,
    null,
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="equipmentId" value={equipmentId} />

      <label className="flex flex-col gap-1.5">
        <span className="label">설비 종류</span>
        <select name="kind" defaultValue={kind} className="input">
          <option value="CONVEYOR">컨베이어</option>
          <option value="ROLLING_MILL">압연설비</option>
          <option value="OTHER">기타 설비</option>
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="label">분당 생산손실 (원)</span>
        <input
          name="downtimeCostPerMin"
          type="number"
          min={0}
          step={1000}
          defaultValue={downtimeCostPerMin || ""}
          placeholder="비워 두면 금액을 계산하지 않습니다"
          className="input num w-56"
        />
      </label>

      <SaveButton />

      {state && "error" in state ? (
        <p className="text-[13px] font-bold" style={{ color: "var(--deny)" }} role="alert">
          {state.error}
        </p>
      ) : null}
      {state && "ok" in state ? (
        <p className="text-[13px] font-bold" style={{ color: "var(--safe)" }} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
