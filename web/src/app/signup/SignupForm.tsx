"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { signupAction, type FormState } from "@/app/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-act w-full" disabled={pending}>
      {pending ? "가입 처리 중…" : "가입하고 시작하기"}
    </button>
  );
}

export function SignupForm() {
  const [state, formAction] = useActionState<FormState, FormData>(signupAction, null);
  const [role, setRole] = useState<"WORKER" | "SAFETY_MANAGER">("WORKER");

  return (
    <form action={formAction} className="paper mt-5 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">
            이름
          </label>
          <input id="name" name="name" className="input" placeholder="홍길동" autoComplete="name" required />
        </div>
        <div>
          <label className="label" htmlFor="employeeNumber">
            사번
          </label>
          <input
            id="employeeNumber"
            name="employeeNumber"
            className="input num"
            placeholder="W1005"
            autoComplete="username"
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="password">
          비밀번호 (8자 이상)
        </label>
        <input id="password" name="password" type="password" className="input" required minLength={8} />
      </div>

      <fieldset>
        <legend className="label">역할 선택</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <RoleCard
            value="WORKER"
            checked={role === "WORKER"}
            onSelect={setRole}
            title="정비 작업자"
            description="설비 안에서 작업하는 동안 개인 시건을 겁니다. 내 시건이 풀리기 전에는 설비가 재가동되지 않습니다."
          />
          <RoleCard
            value="SAFETY_MANAGER"
            checked={role === "SAFETY_MANAGER"}
            onSelect={setRole}
            title="안전관리자"
            description="작업조 설정, 영상 분석, 위험 사건 판단과 벌점 부과를 담당합니다."
          />
        </div>
      </fieldset>

      {role === "SAFETY_MANAGER" ? (
        <p className="text-[13px] leading-6 text-ink-2">
          가입하면 <strong className="font-bold text-ink">바로 안전관리자 화면</strong>으로
          들어갑니다. 위험 사건 판단과 벌점 부과 권한이 함께 주어집니다.
        </p>
      ) : null}

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

function RoleCard({
  value,
  checked,
  onSelect,
  title,
  description,
}: {
  value: "WORKER" | "SAFETY_MANAGER";
  checked: boolean;
  onSelect: (value: "WORKER" | "SAFETY_MANAGER") => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={`cursor-pointer rounded-md border-2 p-3.5 transition-colors ${
        checked ? "bg-act-soft" : "border-rule-soft bg-paper-2 hover:border-rule"
      }`}
      style={checked ? { borderColor: "var(--act)" } : undefined}
    >
      <input
        type="radio"
        name="role"
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span className="flex items-center gap-2 font-semibold">
        <span
          aria-hidden
          style={checked ? { background: "var(--act)" } : undefined}
          className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
            checked ? "border-transparent" : "border-rule"
          }`}
        />
        {title}
      </span>
      <span className="mt-1.5 block text-[13px] leading-6 text-ink-2">{description}</span>
    </label>
  );
}
