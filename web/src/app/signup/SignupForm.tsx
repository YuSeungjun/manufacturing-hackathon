"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { signupAction, type FormState } from "@/app/actions/auth";

type Workplace = {
  id: string;
  name: string;
  teams: { id: string; name: string; workArea: string }[];
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-act w-full" disabled={pending}>
      {pending ? "가입 처리 중…" : "가입하고 시작하기"}
    </button>
  );
}

export function SignupForm({ workplaces }: { workplaces: Workplace[] }) {
  const [state, formAction] = useActionState<FormState, FormData>(signupAction, null);
  const [workplaceId, setWorkplaceId] = useState(workplaces[0]?.id ?? "");
  const [role, setRole] = useState<"WORKER" | "SAFETY_MANAGER">("WORKER");

  const teams = workplaces.find((w) => w.id === workplaceId)?.teams ?? [];

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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="workplaceId">
            소속 사업장
          </label>
          <select
            id="workplaceId"
            name="workplaceId"
            className="input"
            value={workplaceId}
            onChange={(event) => setWorkplaceId(event.target.value)}
          >
            {workplaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="teamId">
            부서 · 작업조
          </label>
          <select id="teamId" name="teamId" className="input" required>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.workArea})
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="label">역할 선택</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <RoleCard
            value="WORKER"
            checked={role === "WORKER"}
            onSelect={setRole}
            title="작업자"
            description="배정된 TBM을 확인하고 안전수칙에 서명합니다. 본인의 이행 현황과 알림을 봅니다."
          />
          <RoleCard
            value="SAFETY_MANAGER"
            checked={role === "SAFETY_MANAGER"}
            onSelect={setRole}
            title="안전관리자"
            description="TBM 작성, 전체 안전 현황 조회, AI 탐지 결과의 최종 판단에 사용되며 소속 확인 후 승인됩니다."
          />
        </div>
      </fieldset>

      {role === "SAFETY_MANAGER" ? (
        <div>
          <label className="label" htmlFor="managerCode">
            안전관리자 인증번호 (선택)
          </label>
          <input
            id="managerCode"
            name="managerCode"
            className="input"
            placeholder="예: GY-SAFETY-2026"
          />
          <p className="mt-1.5 text-[13px] leading-6 text-ink-2">
            인증번호가 맞으면 바로 승인됩니다. 모른다면 비워 두세요. 승인 전까지는 작업자
            화면만 이용할 수 있습니다.
          </p>
        </div>
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
