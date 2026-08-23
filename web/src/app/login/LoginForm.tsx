"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type FormState } from "@/app/actions/auth";
import {
  alertMutedOnServer,
  isAlertMuted,
  playAlertSound,
  primeAlertSound,
  setAlertMuted,
  stopAlertSound,
  subscribeAlertMuted,
} from "@/lib/alertSound";

function SubmitButton({ onPress }: { onPress: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-act mt-1 w-full"
      disabled={pending}
      // 이 클릭이 유일한 사용자 조작이다. 여기서 오디오를 열어 두지 않으면
      // 로그인 직후 현황판 팝업에서 알림음이 브라우저에 막힌다.
      onClick={onPress}
    >
      {pending ? "확인 중…" : "로그인"}
    </button>
  );
}

/** 알림음을 쓸지 여기서 정한다. 브라우저에 소리 권한 프롬프트가 없어 앱이 직접 묻는다. */
function AlertSoundChoice() {
  const muted = useSyncExternalStore(subscribeAlertMuted, isAlertMuted, alertMutedOnServer);
  const [tested, setTested] = useState(false);

  return (
    <div className="well flex flex-wrap items-center gap-x-3 gap-y-2">
      <label className="flex flex-1 items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={!muted}
          onChange={(event) => {
            const next = !event.target.checked;
            setAlertMuted(next);
            if (next) stopAlertSound();
            else primeAlertSound();
          }}
        />
        CCTV 감지 알림음 사용
      </label>
      <button
        type="button"
        className="btn-quiet btn-sm"
        disabled={muted}
        onClick={async () => {
          setTested(await playAlertSound());
        }}
      >
        소리 확인
      </button>
      {tested ? (
        <p className="w-full text-[12px] text-ink-3">
          소리가 들렸다면 그대로 두세요. 로그인 후 감지 알림에 이 소리가 납니다.
        </p>
      ) : null}
    </div>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<FormState, FormData>(loginAction, null);

  return (
    <form action={formAction} className="mt-5 space-y-3.5">
      <div>
        <label className="label" htmlFor="employeeNumber">
          사번
        </label>
        <input
          id="employeeNumber"
          name="employeeNumber"
          className="input num"
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
        />
      </div>
      {state?.error ? (
        <p
          role="alert"
          className="rounded-md border px-3 py-2.5 text-[13px] leading-6"
          style={{ borderColor: "var(--deny)", background: "var(--deny-soft)", color: "var(--deny)" }}
        >
          {state.error}
        </p>
      ) : null}
      <SubmitButton onPress={() => { if (!isAlertMuted()) primeAlertSound(); }} />
      <AlertSoundChoice />
    </form>
  );
}
