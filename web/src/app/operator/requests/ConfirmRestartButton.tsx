"use client";

import { useFormStatus } from "react-dom";
import { confirmRestartedAction } from "@/app/actions/restart";

function Button({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-safe btn-sm" disabled={pending}>
      {pending ? "확인 중…" : label}
    </button>
  );
}

/** 실제 재가동 직전에 인터록을 한 번 더 본다. 요청 뒤 상황이 바뀔 수 있다. */
export function ConfirmRestartButton({ requestId, label }: { requestId: string; label: string }) {
  return (
    <form action={confirmRestartedAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <Button label={label} />
    </form>
  );
}
