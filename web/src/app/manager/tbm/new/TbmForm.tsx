"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createTbmAction, type TbmFormState } from "@/app/actions/tbm";
import { formatIsoDateKo, todayLocalISO } from "@/lib/date";
import { PPE_CODES, PPE_CODE_LIST } from "@/lib/ppe";

type Worker = { id: string; name: string; employeeNumber: string };
type Team = { id: string; name: string; workArea: string; workers: Worker[] };

type RuleDraft = {
  hazard: string;
  description: string;
  detectionType: "CCTV" | "SENSOR" | "MANUAL";
  ppeCode: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
};

const EMPTY_RULE: RuleDraft = {
  hazard: "",
  description: "",
  detectionType: "MANUAL",
  ppeCode: "",
  severity: "MEDIUM",
};

const DEFAULT_RULES: RuleDraft[] = [
  {
    hazard: "낙하물 및 상부 설비 충돌",
    description: PPE_CODES.NO_HARDHAT.rule,
    detectionType: "CCTV",
    ppeCode: "NO_HARDHAT",
    severity: "HIGH",
  },
  {
    hazard: "중장비 통행 중 작업자 미인지",
    description: PPE_CODES.NO_SAFETY_VEST.rule,
    detectionType: "CCTV",
    ppeCode: "NO_SAFETY_VEST",
    severity: "MEDIUM",
  },
  { ...EMPTY_RULE },
];

function SubmitButton({ count, assignees }: { count: number; assignees: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-act w-full sm:w-auto sm:px-6"
      disabled={pending || count === 0 || assignees === 0}
    >
      {pending ? "등록 중…" : "TBM 등록하고 작업조에 배정"}
    </button>
  );
}

export function TbmForm({ teams }: { teams: Team[] }) {
  const [state, formAction] = useActionState<TbmFormState, FormData>(createTbmAction, null);
  const [rules, setRules] = useState<RuleDraft[]>(DEFAULT_RULES);
  // 작업일과 작업조가 "누가 이 TBM 을 보는지"를 결정한다. 둘 다 상태로 들고 있다가
  // 등록 직전에 배정 대상을 문장으로 보여 준다.
  const [workDate, setWorkDate] = useState(todayLocalISO());
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");

  const team = teams.find((t) => t.id === teamId);
  const isToday = workDate === todayLocalISO();

  // 작업조를 바꾸면 서명 대상을 그 조 전원으로 다시 잡는다.
  // 보통은 조 전체가 투입되므로 전원 선택이 기본이고, 빠지는 사람만 꺼 준다.
  const [excluded, setExcluded] = useState<Record<string, true>>({});
  const assignees = (team?.workers ?? []).filter((w) => !excluded[w.id]);

  function update(index: number, patch: Partial<RuleDraft>) {
    setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  const filled = rules.filter((rule) => rule.hazard.trim() && rule.description.trim());

  return (
    <form action={formAction} className="mt-5 space-y-4">
      <input type="hidden" name="rules" value={JSON.stringify(filled)} />
      <input type="hidden" name="assigneeIds" value={JSON.stringify(assignees.map((w) => w.id))} />

      <div className="paper grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="workDate">
            작업일
          </label>
          <input
            id="workDate"
            name="workDate"
            type="date"
            className="input"
            value={workDate}
            onChange={(event) => setWorkDate(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="teamId">
            작업조
          </label>
          <select
            id="teamId"
            name="teamId"
            className="input"
            value={teamId}
            onChange={(event) => {
              setTeamId(event.target.value);
              setExcluded({});
            }}
          >
            {teams.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.workArea}) · {option.workers.length}명
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <fieldset>
            <legend className="label">
              오늘 투입되는 작업자{" "}
              <span className="num font-normal text-ink-3">
                {assignees.length}/{team?.workers.length ?? 0}
              </span>
            </legend>
            {team && team.workers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {team.workers.map((worker) => {
                  const on = !excluded[worker.id];
                  return (
                    <label
                      key={worker.id}
                      className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md border-2 px-3
                                  text-[13.5px] transition-colors ${
                                    on ? "bg-act-soft font-bold" : "border-rule-soft bg-paper-2 text-ink-3"
                                  }`}
                      style={on ? { borderColor: "var(--act)" } : undefined}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() =>
                          setExcluded((prev) => {
                            const next = { ...prev };
                            if (on) next[worker.id] = true;
                            else delete next[worker.id];
                            return next;
                          })
                        }
                      />
                      <span
                        aria-hidden
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-2 text-[10px] font-bold"
                        style={
                          on
                            ? { borderColor: "var(--act)", background: "var(--act)", color: "var(--act-ink)" }
                            : { borderColor: "var(--rule)" }
                        }
                      >
                        {on ? "✓" : ""}
                      </span>
                      {worker.name}
                      <span className="num text-[11.5px] font-normal text-ink-3">
                        {worker.employeeNumber}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] leading-6" style={{ color: "var(--hold)" }}>
                이 작업조에 등록된 작업자가 없습니다. 작업자가 가입하면 여기에 나타납니다.
              </p>
            )}
            <p className="mt-2 text-[12.5px] leading-5 text-ink-3">
              기본은 작업조 전원입니다. 오늘 빠지는 사람은 눌러서 꺼 주세요. 꺼진 사람에게는
              TBM 이 배정되지 않고 서명률에도 들어가지 않습니다.
            </p>
          </fieldset>
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="workType">
            오늘 할 작업
          </label>
          <input
            id="workType"
            name="workType"
            className="input"
            placeholder="예: 전로 출강구 보수 작업"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="summary">
            작업 개요 (선택)
          </label>
          <textarea id="summary" name="summary" rows={2} className="input" />
        </div>
      </div>

      <div className="paper">
        <div className="flex items-center justify-between gap-3">
          <h2 className="h2">위험 요인과 안전 대책</h2>
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => setRules((prev) => [...prev, { ...EMPTY_RULE }])}
          >
            + 항목 추가
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {rules.map((rule, index) => (
            <div
              key={index}
              className="rounded-md border border-rule-soft bg-paper-2 p-3.5"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow">
                  항목 <span className="num">{index + 1}</span>
                  {rule.ppeCode ? <span className="tag tag-act ml-2">AI 확인</span> : null}
                </span>
                {rules.length > 1 ? (
                  <button
                    type="button"
                    className="-mr-2 -my-1 cursor-pointer rounded-md px-2.5 py-2.5 text-[12px]
                               text-ink-3 hover:text-deny"
                    onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                  >
                    삭제
                  </button>
                ) : null}
              </div>

              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="sr-only" htmlFor={`hazard-${index}`}>
                    위험 요인
                  </label>
                  <input
                    id={`hazard-${index}`}
                    className="input bg-paper"
                    placeholder="위험 요인 (예: 낙하물)"
                    value={rule.hazard}
                    onChange={(event) => update(index, { hazard: event.target.value })}
                  />
                </div>
                <div>
                  <label className="sr-only" htmlFor={`desc-${index}`}>
                    안전 대책
                  </label>
                  <input
                    id={`desc-${index}`}
                    className="input bg-paper"
                    placeholder="안전 대책 (예: 안전모 착용)"
                    value={rule.description}
                    onChange={(event) => update(index, { description: event.target.value })}
                  />
                </div>
              </div>

              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
                <select
                  aria-label={`항목 ${index + 1} 위험도`}
                  className="input bg-paper"
                  value={rule.severity}
                  onChange={(event) =>
                    update(index, { severity: event.target.value as RuleDraft["severity"] })
                  }
                >
                  <option value="HIGH">위험도 높음 (−20점)</option>
                  <option value="MEDIUM">위험도 보통 (−10점)</option>
                  <option value="LOW">위험도 낮음 (−10점)</option>
                </select>

                <select
                  aria-label={`항목 ${index + 1} 점검 방식`}
                  className="input bg-paper"
                  value={rule.detectionType}
                  onChange={(event) =>
                    update(index, {
                      detectionType: event.target.value as RuleDraft["detectionType"],
                    })
                  }
                >
                  <option value="MANUAL">육안 점검</option>
                  <option value="CCTV">CCTV 영상 분석</option>
                  <option value="SENSOR">센서</option>
                </select>

                <select
                  aria-label={`항목 ${index + 1} AI 확인 대상`}
                  className="input bg-paper"
                  value={rule.ppeCode}
                  onChange={(event) => {
                    const ppeCode = event.target.value;
                    update(index, {
                      ppeCode,
                      detectionType: ppeCode ? "CCTV" : rule.detectionType,
                    });
                  }}
                >
                  <option value="">AI 자동 확인 안 함</option>
                  {PPE_CODE_LIST.map((code) => (
                    <option key={code} value={code}>
                      AI 확인 · {PPE_CODES[code].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[13px] leading-6 text-ink-2">
          <b className="tag tag-act">AI 확인</b> 이 붙은 항목은 영상 분석에서 위반이 의심될 때 자동으로
          검토 대기에 올라갑니다. 감점은 안전관리자가 위반으로 확정한 뒤에만 적용됩니다.
        </p>
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

      {/* 등록하면 누구 화면에 뜨는지 미리 보여 준다.
          날짜나 작업조가 어긋나면 작업자는 "배정된 TBM 없음"만 보게 된다. */}
      <div
        className="rounded-lg border-2 px-4 py-3.5"
        style={
          isToday
            ? { borderColor: "var(--act)", background: "var(--act-soft)" }
            : { borderColor: "var(--hold)", background: "var(--hold-soft)" }
        }
      >
        <p className="eyebrow">서명 대상</p>
        <p className="mt-1.5 text-[14px] leading-6">
          <b>{formatIsoDateKo(workDate)}</b> · <b>{team?.name ?? "작업조 미선택"}</b>
          {assignees.length > 0 ? (
            <>
              {" "}
              작업자 <span className="num font-bold">{assignees.length}</span>명에게 서명을 받습니다
            </>
          ) : (
            <span style={{ color: "var(--deny)" }}> · 선택된 작업자가 없습니다</span>
          )}
        </p>
        {isToday ? null : (
          <p className="mt-1.5 text-[13px] leading-6" style={{ color: "var(--hold)" }}>
            오늘이 아닙니다. 작업자 화면에는 그날 당일에만 보입니다. 지금 바로 보이게 하려면
            작업일을 오늘({formatIsoDateKo(todayLocalISO())})로 바꿔 주세요.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton count={filled.length} assignees={assignees.length} />
        <span className="text-[13px] text-ink-2">
          안전수칙 <span className="num font-semibold text-ink">{filled.length}</span>개 작성됨
          {filled.length === 0 ? " · 위험 요인과 안전 대책을 한 쌍 이상 채워 주세요" : ""}
        </span>
      </div>
    </form>
  );
}
