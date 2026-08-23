"use client";

import { useFormStatus } from "react-dom";
import { lockLotoAction, releaseLotoAction } from "@/app/actions/work";

function Button({ label, tone }: { label: string; tone: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={tone} disabled={pending}>
      {pending ? "처리 중…" : label}
    </button>
  );
}

export function LotoButtons({ workId, locked }: { workId: string; locked: boolean }) {
  return (
    <form action={locked ? releaseLotoAction : lockLotoAction} className="flex items-center gap-2">
      <input type="hidden" name="workId" value={workId} />
      <Button
        label={locked ? "작업 종료 · 내 시건 해제" : "작업 시작 · 내 시건 걸기"}
        tone={locked ? "btn-safe" : "btn-act"}
      />
    </form>
  );
}
