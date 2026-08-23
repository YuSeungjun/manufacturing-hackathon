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
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="label">설비 번호</span>
          <input name="code" className="input num" placeholder="RM-02" required maxLength={24} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">설비 이름</span>
          <input name="name" className="input" placeholder="조압연기 2호" required maxLength={60} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">라인</span>
          <input name="line" className="input" placeholder="열연 1라인" maxLength={60} />
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
