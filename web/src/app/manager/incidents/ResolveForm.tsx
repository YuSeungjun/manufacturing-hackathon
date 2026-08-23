"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { resolveIncidentAction, type ResolveState } from "@/app/actions/risk";
import { CONFIRMED_EVENT_PENALTY, MAX_EVENT_PENALTY, penaltyLadder } from "@/lib/score";

export type TeamChoice = {
  id: string;
  name: string;
  workArea: string;
  memberCount: number;
  /** 오늘 이 조에 이미 부과된 확정 건수. 이번 건의 벌점이 여기서 정해진다. */
  chargedToday: number;
};

function Submit({
  decision,
  label,
  tone,
  disabled,
}: {
  decision: string;
  label: string;
  tone: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="decision"
      value={decision}
      className={`btn-sm ${tone}`}
      disabled={pending || disabled}
    >
      {label}
    </button>
  );
}

/**
 * 진행 중인 사건의 종결.
 *
 * **벌점 부과** 실제 위험이었다. 책임 있는 작업조를 골라 그 조의 점수를 깎는다.
 * **현장 조치 완료** 확인하고 처리했다. 벌점은 없다.
 *
 * 벌점은 조를 고르는 창을 한 번 거친다. 버튼 하나로 바로 깎이면 누구 점수인지 모르는 채
 * 감점이 쌓이고, 나중에 아무도 그 감점을 설명하지 못한다. 점수를 깎는 행위는 대상을
 * 지목하는 행위와 같이 일어나야 한다.
 *
 * 조를 설비로 추론하지 않는 이유 — 한 설비에 여러 조가 붙고, 정비 작업이 등록되지 않은
 * 조는 사건이 아무리 나도 점수가 안 깎인다. 누가 책임지는지는 사람이 정하는 일이다.
 */
export function ResolveForm({
  riskEventId,
  teams,
}: {
  riskEventId: string;
  teams: TeamChoice[];
}) {
  const [state, action] = useActionState<ResolveState, FormData>(resolveIncidentAction, null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [teamId, setTeamId] = useState("");
  const chosen = teams.find((team) => team.id === teamId);
  const ladder = penaltyLadder(chosen?.chargedToday ?? 0);

  // 종결되면 창을 닫는다. 열린 채로 남으면 이미 처리된 사건에 또 부과하려 든다.
  useEffect(() => {
    if (state && "ok" in state) dialogRef.current?.close();
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-2 border-t border-rule-soft pt-2.5">
      <input type="hidden" name="riskEventId" value={riskEventId} />
      <label className="flex flex-col gap-1">
        <span className="sr-only">현장 조치 내용</span>
        <input
          name="comment"
          className="input py-1.5 text-[13px]"
          placeholder="현장 조치 내용 (선택)"
          maxLength={500}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-sm btn-deny"
          onClick={() => dialogRef.current?.showModal()}
        >
          벌점 부과
        </button>
        <Submit decision="PASSED" label="현장 조치 완료" tone="btn-quiet" />
      </div>

      <p className="text-[12px] leading-5 text-ink-3">
        <strong className="font-bold text-ink-2">벌점 부과</strong> — 실제 위험이었습니다. 첫 건은{" "}
        <span className="num">{CONFIRMED_EVENT_PENALTY}</span>점, 같은 조가 오늘 되풀이하면 건마다
        2배가 되어 최대 <span className="num">{MAX_EVENT_PENALTY}</span>점까지 깎입니다.{" "}
        <strong className="font-bold text-ink-2">현장 조치 완료</strong> — 확인하고 처리했으며
        벌점은 없습니다.
      </p>

      {state && "error" in state ? (
        <p className="text-[12.5px] font-bold" style={{ color: "var(--deny)" }} role="alert">
          {state.error}
        </p>
      ) : null}
      {state && "ok" in state ? (
        <p className="text-[12.5px] font-bold" style={{ color: "var(--safe)" }} role="status">
          {state.message}
        </p>
      ) : null}

      {/* 창이 form 안에 있어야 고른 조가 같은 제출에 실려 간다. */}
      <dialog ref={dialogRef} className="paper max-w-[26rem] p-0 backdrop:bg-black/45">
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[14.5px] font-bold">어느 작업조에 벌점을 부과합니까?</p>
          <p className="text-[12.5px] leading-5 text-ink-2">
            {chosen ? (
              <>
                <span className="font-bold">{chosen.name}</span>은 오늘{" "}
                <span className="num">{ladder.ordinal}</span>번째 확정이라{" "}
                <span className="num font-bold" style={{ color: "var(--deny)" }}>
                  {ladder.points}
                </span>
                점이 깎입니다.
                {ladder.ordinal > 1 ? " 되풀이라 2배로 매겼습니다." : ""}
                {ladder.capped ? " 여기서 더 올리지 않습니다." : ""}
              </>
            ) : (
              <>
                조를 고르면 그 조에서 깎일 점수가 여기에 나옵니다. 설비로 추론하지 않고 여기서
                지목한 조에만 반영됩니다.
              </>
            )}
          </p>

          {teams.length === 0 ? (
            <p className="text-[13px] font-bold" style={{ color: "var(--deny)" }}>
              등록된 작업조가 없습니다. 조 설정에서 먼저 만들어 주세요.
            </p>
          ) : (
            <ul className="ruled max-h-[16rem] overflow-y-auto">
              {teams.map((team) => (
                <li key={team.id}>
                  <label className="flex cursor-pointer items-start gap-2.5 py-2">
                    <input
                      type="radio"
                      name="teamId"
                      value={team.id}
                      checked={teamId === team.id}
                      onChange={() => setTeamId(team.id)}
                      className="mt-0.5"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[13.5px] font-bold">{team.name}</span>
                      <span className="text-[12px] text-ink-3">
                        {team.workArea} · 조원 <span className="num">{team.memberCount}</span>명
                        {team.chargedToday > 0 ? (
                          <>
                            {" · "}
                            <span style={{ color: "var(--hold)" }}>
                              오늘 <span className="num">{team.chargedToday}</span>건 확정
                            </span>
                          </>
                        ) : null}
                      </span>
                      <span className="num text-[12px] font-bold" style={{ color: "var(--deny)" }}>
                        이번 건 {penaltyLadder(team.chargedToday).points}점
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="btn-quiet btn-sm"
              onClick={() => dialogRef.current?.close()}
            >
              취소
            </button>
            <Submit
              decision="CONFIRMED"
              label={chosen ? `${ladder.points}점 부과` : "점수 부과"}
              tone="btn-deny"
              disabled={!teamId}
            />
          </div>
        </div>
      </dialog>
    </form>
  );
}
