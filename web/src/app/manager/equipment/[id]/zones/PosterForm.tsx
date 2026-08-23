"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveCameraPosterAction, type EquipmentState } from "@/app/actions/equipment";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-act" disabled={pending}>
      {pending ? "올리는 중…" : "카메라 화면 등록"}
    </button>
  );
}

export function PosterForm({ equipmentId, cameraId }: { equipmentId: string; cameraId: string | null }) {
  const [state, action] = useActionState<EquipmentState, FormData>(saveCameraPosterAction, null);

  return (
    <form action={action} className="paper flex flex-wrap items-end gap-3 p-4">
      <input type="hidden" name="equipmentId" value={equipmentId} />
      <input type="hidden" name="cameraId" value={cameraId ?? ""} />
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="label">CCTV 정지 프레임</span>
        <input type="file" name="poster" accept="image/*" required className="input" />
      </label>
      <SubmitButton />
      {state && "error" in state ? (
        <p className="w-full text-[13px] font-bold" style={{ color: "var(--deny)" }} role="alert">
          {state.error}
        </p>
      ) : null}
      {state && "ok" in state ? (
        <p className="w-full text-[13px] font-bold" style={{ color: "var(--safe)" }} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
