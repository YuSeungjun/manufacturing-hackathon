"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createMaintenanceWorkAction, type WorkState } from "@/app/actions/work";

type Member = { id: string; name: string; employeeNumber: string };
type Team = { id: string; name: string; workArea: string; members: Member[] };

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-act" disabled={pending || disabled}>
      {pending ? "여는 중…" : "정비 작업 열기"}
    </button>
  );
}

export function WorkForm({
  equipment,
  teams,
  today,
}: {
  equipment: { id: string; code: string; name: string }[];
  teams: Team[];
  today: string;
}) {
  const [state, action] = useActionState<WorkState, FormData>(createMaintenanceWorkAction, null);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const members = teams.find((t) => t.id === teamId)?.members ?? [];
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <form action={action} className="paper flex flex-col gap-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label">설비</span>
          <select name="equipmentId" className="input" required defaultValue="">
            <option value="" disabled>
              설비를 고르세요
            </option>
            {equipment.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">작업일</span>
          <input type="date" name="workDate" className="input num" defaultValue={today} required />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="label">작업 이름</span>
        <input name="title" className="input" placeholder="조압연 2호 백업롤 교체" required maxLength={80} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="label">작업 내용</span>
        <textarea
          name="summary"
          className="input min-h-20"
          placeholder="상부 백업롤 교체 및 롤 갭 청소. 작업 중 설비 재가동 금지."
          maxLength={500}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="label">작업조</span>
        <select
          name="teamId"
          className="input"
          value={teamId}
          onChange={(e) => {
            setTeamId(e.target.value);
            setPicked([]);
          }}
          required
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name} · {team.workArea}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 rounded-md border border-rule px-3 py-3">
        <legend className="label px-1">투입 작업자</legend>
        <p className="text-[12.5px] text-ink-3">
          조 전원이 아니라 실제로 설비 안에 들어가는 사람만 고릅니다. 여기 선택된 사람이 개인
          시건을 걸 수 있습니다.
        </p>
        {members.length === 0 ? (
          <p className="text-[13px] text-ink-3">이 작업조에 승인된 작업자가 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {members.map((member) => {
              const on = picked.includes(member.id);
              return (
                <label
                  key={member.id}
                  className={`cursor-pointer rounded-md border-2 px-3 py-2 text-[13px] transition-colors ${
                    on ? "bg-act-soft font-bold" : "border-rule-soft bg-paper-2 hover:border-rule"
                  }`}
                  style={on ? { borderColor: "var(--act)" } : undefined}
                >
                  <input
                    type="checkbox"
                    name="assigneeIds"
                    value={member.id}
                    checked={on}
                    onChange={(e) =>
                      setPicked((prev) =>
                        e.target.checked ? [...prev, member.id] : prev.filter((id) => id !== member.id),
                      )
                    }
                    className="sr-only"
                  />
                  {member.name} <span className="num text-ink-3">{member.employeeNumber}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      {state && "error" in state ? (
        <p className="text-[13px] font-bold" style={{ color: "var(--deny)" }} role="alert">
          {state.error}
        </p>
      ) : null}
      {state && "ok" in state ? (
        <p className="text-[13px] font-bold" style={{ color: "var(--safe)" }} role="status">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-3">
          작업을 열면 이 설비는 정비 상태가 되고 재가동이 잠깁니다.
        </p>
        <SubmitButton disabled={picked.length === 0} />
      </div>
    </form>
  );
}
