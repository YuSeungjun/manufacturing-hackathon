"use client";

import { useFormStatus } from "react-dom";
import { approveRestartAction, rejectRestartAction } from "@/app/actions/restart";

function Button({
  action,
  label,
  tone,
  disabled,
}: {
  action: (formData: FormData) => void;
  label: string;
  tone: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" formAction={action} className={`btn-sm ${tone}`} disabled={pending || disabled}>
      {label}
    </button>
  );
}

/**
 * 인터록을 푸는 유일한 자리.
 *
 * 승인은 "현장에 사람이 없는 걸 내 눈으로 봤다"는 진술이다. 그래서 확인 문구를 붙인다.
 */
export function ApprovalForm({ requestId, blocked }: { requestId: string; blocked: boolean }) {
  return (
    <form className="flex flex-col gap-2 border-t border-rule pt-3">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="flex flex-col gap-1">
        <span className="label">현장 확인 내용</span>
        <input
          name="approvalNote"
          className="input py-1.5 text-[13px]"
          placeholder="예: 롤 갭 하부 육안 확인, 작업자 2명 퇴출 완료"
          maxLength={300}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button action={approveRestartAction} label="현장 확인 완료 · 재가동 허용" tone="btn-safe" disabled={blocked} />
        <Button action={rejectRestartAction} label="반려" tone="btn-quiet" />
      </div>
    </form>
  );
}
