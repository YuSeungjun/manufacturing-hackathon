"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  assignTeamMembersAction,
  assignWorkersToWorkAction,
  createTeamAction,
  type TeamSettingsState,
} from "@/app/actions/teams";

type Worker = {
  id: string;
  name: string;
  employeeNumber: string;
  teamId: string | null;
  teamName: string | null;
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-act btn-sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: TeamSettingsState }) {
  if (!state) return null;
  return (
    <p
      role={"error" in state ? "alert" : "status"}
      className="text-[12.5px] font-bold"
      style={{ color: "error" in state ? "var(--deny)" : "var(--safe)" }}
    >
      {"error" in state ? state.error : state.message}
    </p>
  );
}

export function CreateTeamForm() {
  const [state, action] = useActionState<TeamSettingsState, FormData>(createTeamAction, null);
  return (
    <form action={action} className="paper flex flex-col gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label">조 이름</span>
          <input name="name" className="input" placeholder="소결 정비 3조" maxLength={60} required />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">담당 구역</span>
          <input name="workArea" className="input" placeholder="소결공장 원료이송" maxLength={100} required />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Feedback state={state} />
        <SubmitButton label="작업조 만들기" pendingLabel="만드는 중…" />
      </div>
    </form>
  );
}

export function TeamMemberForm({
  teamId,
  workers,
}: {
  teamId: string;
  workers: Worker[];
}) {
  const [state, action] = useActionState<TeamSettingsState, FormData>(assignTeamMembersAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="teamId" value={teamId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="label">조원 편성</legend>
        {workers.length === 0 ? (
          <p className="text-[13px] text-ink-3">배치할 수 있는 승인 작업자가 없습니다.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {workers.map((worker) => {
              const belongsHere = worker.teamId === teamId;
              return (
                <label
                  key={worker.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-rule-soft bg-paper-2 px-3 py-2.5"
                >
                  <input
                    type="checkbox"
                    name="memberIds"
                    value={worker.id}
                    defaultChecked={belongsHere}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold">
                      {worker.name} <span className="num text-ink-3">{worker.employeeNumber}</span>
                    </span>
                    <span className="block text-[11.5px] text-ink-3">
                      {belongsHere ? "현재 조원" : worker.teamName ? `현재 ${worker.teamName}` : "미배치"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Feedback state={state} />
        <SubmitButton label="조원 저장" pendingLabel="저장 중…" />
      </div>
    </form>
  );
}

export function WorkAssigneeForm({
  workId,
  members,
  assignedIds,
  lockedIds,
}: {
  workId: string;
  members: Omit<Worker, "teamId" | "teamName">[];
  assignedIds: string[];
  lockedIds: string[];
}) {
  const [state, action] = useActionState<TeamSettingsState, FormData>(assignWorkersToWorkAction, null);
  return (
    <form action={action} className="flex flex-col gap-2.5 rounded-md border border-rule-soft bg-paper-2 p-3">
      <input type="hidden" name="workId" value={workId} />
      <fieldset>
        <legend className="sr-only">작업 투입자</legend>
        <div className="flex flex-wrap gap-2">
          {members.map((member) => (
            <label key={member.id} className="tag cursor-pointer">
              <input
                type="checkbox"
                name="assigneeIds"
                value={member.id}
                defaultChecked={assignedIds.includes(member.id)}
                className="mr-0.5"
              />
              {member.name}
              {lockedIds.includes(member.id) ? <span className="text-act">시건 중</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Feedback state={state} />
        <SubmitButton label="투입자 저장" pendingLabel="저장 중…" />
      </div>
    </form>
  );
}
