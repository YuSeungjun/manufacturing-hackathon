"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type FormState } from "@/app/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-act mt-1 w-full" disabled={pending}>
      {pending ? "확인 중…" : "로그인"}
    </button>
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
      <SubmitButton />
    </form>
  );
}
