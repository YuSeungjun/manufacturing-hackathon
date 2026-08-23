"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createEquipmentAction, type EquipmentState } from "@/app/actions/equipment";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-act" disabled={pending}>
      {pending ? "등록 중…" : "설비 등록"}
    </button>
  );
}

export function EquipmentForm() {
  const [state, action] = useActionState<EquipmentState, FormData>(createEquipmentAction, null);

  return (
    <form action={action} className="paper flex flex-col gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5">
          <span className="label">설비 번호</span>
          <input name="code" className="input num" placeholder="CV-01" required maxLength={24} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">설비 이름</span>
          <input name="name" className="input" placeholder="원료 이송 컨베이어 1호" required maxLength={60} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">라인</span>
          <input name="line" className="input" placeholder="소결 1라인" maxLength={60} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">설비 종류</span>
          <select name="kind" defaultValue="CONVEYOR" className="input">
            <option value="CONVEYOR">컨베이어</option>
            <option value="ROLLING_MILL">압연설비</option>
            <option value="OTHER">기타 설비</option>
          </select>
        </label>
      </div>

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

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
