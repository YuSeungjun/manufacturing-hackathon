"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type TeamSettingsState = null | { error: string } | { ok: true; message: string };

function revalidateTeams() {
  revalidatePath("/manager", "layout");
  revalidatePath("/manager/teams");
  revalidatePath("/manager/works");
  revalidatePath("/worker");
}

export async function createTeamAction(
  _prev: TeamSettingsState,
  formData: FormData,
): Promise<TeamSettingsState> {
  const manager = await assertManager();
  const parsed = z
    .object({
      name: z.string().trim().min(1, "조 이름을 입력해 주세요.").max(60),
      workArea: z.string().trim().min(1, "담당 구역을 입력해 주세요.").max(100),
    })
    .safeParse({ name: formData.get("name"), workArea: formData.get("workArea") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  }

  const exists = await prisma.team.findFirst({
    where: { workplaceId: manager.workplaceId, name: parsed.data.name },
  });
  if (exists) return { error: "같은 이름의 작업조가 이미 있습니다." };

  await prisma.team.create({
    data: { ...parsed.data, workplaceId: manager.workplaceId },
  });
  revalidateTeams();
  return { ok: true, message: `${parsed.data.name}을(를) 만들었습니다.` };
}

export async function assignTeamMembersAction(
  _prev: TeamSettingsState,
  formData: FormData,
): Promise<TeamSettingsState> {
  const manager = await assertManager();
  const teamId = String(formData.get("teamId") ?? "");
  const memberIds = [...new Set(formData.getAll("memberIds").map(String).filter(Boolean))];

  const [team, selected, current] = await Promise.all([
    prisma.team.findFirst({ where: { id: teamId, workplaceId: manager.workplaceId } }),
    prisma.user.findMany({
      where: {
        id: { in: memberIds },
        workplaceId: manager.workplaceId,
        role: "WORKER",
        approvalStatus: "APPROVED",
      },
      select: { id: true },
    }),
    prisma.user.findMany({
      where: { workplaceId: manager.workplaceId, teamId, role: "WORKER" },
      select: { id: true, name: true },
    }),
  ]);
  if (!team) return { error: "작업조를 찾을 수 없습니다." };
  if (selected.length !== memberIds.length) {
    return { error: "배치할 수 없는 작업자가 포함되어 있습니다." };
  }

  const activeAssignmentInAnotherTeam = await prisma.workAssignee.findFirst({
    where: {
      userId: { in: memberIds },
      work: {
        teamId: { not: team.id },
        workplaceId: manager.workplaceId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
    },
    include: { user: { select: { name: true } }, work: { select: { title: true } } },
  });
  if (activeAssignmentInAnotherTeam) {
    return {
      error: `${activeAssignmentInAnotherTeam.user.name} 작업자가 "${activeAssignmentInAnotherTeam.work.title}"에 투입 중입니다. 먼저 기존 작업의 투입자를 변경해 주세요.`,
    };
  }

  const selectedSet = new Set(selected.map((worker) => worker.id));
  const removing = current.filter((worker) => !selectedSet.has(worker.id));
  if (removing.length > 0) {
    const activeAssignments = await prisma.workAssignee.findMany({
      where: {
        userId: { in: removing.map((worker) => worker.id) },
        work: { teamId: team.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
      },
      include: { user: { select: { name: true } }, work: { select: { title: true } } },
    });
    if (activeAssignments.length > 0) {
      const first = activeAssignments[0];
      return {
        error: `${first.user.name} 작업자가 "${first.work.title}"에 투입 중입니다. 먼저 해당 작업의 투입자를 변경해 주세요.`,
      };
    }
  }

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { workplaceId: manager.workplaceId, teamId: team.id, id: { notIn: memberIds } },
      data: { teamId: null },
    }),
    prisma.user.updateMany({
      where: { workplaceId: manager.workplaceId, id: { in: memberIds } },
      data: { teamId: team.id },
    }),
  ]);
  revalidateTeams();
  return { ok: true, message: `${team.name} 조원 ${memberIds.length}명을 저장했습니다.` };
}

export async function assignWorkersToWorkAction(
  _prev: TeamSettingsState,
  formData: FormData,
): Promise<TeamSettingsState> {
  const manager = await assertManager();
  const workId = String(formData.get("workId") ?? "");
  const assigneeIds = [...new Set(formData.getAll("assigneeIds").map(String).filter(Boolean))];
  if (assigneeIds.length === 0) return { error: "투입 작업자를 한 명 이상 선택해 주세요." };

  const work = await prisma.maintenanceWork.findFirst({
    where: {
      id: workId,
      workplaceId: manager.workplaceId,
      status: { in: ["OPEN", "IN_PROGRESS"] },
    },
    include: { assignees: true, locks: { where: { releasedAt: null } } },
  });
  if (!work) return { error: "진행 중인 작업을 찾을 수 없습니다." };

  const workers = await prisma.user.findMany({
    where: {
      id: { in: assigneeIds },
      workplaceId: manager.workplaceId,
      teamId: work.teamId,
      role: "WORKER",
      approvalStatus: "APPROVED",
    },
    select: { id: true },
  });
  if (workers.length !== assigneeIds.length) {
    return { error: "선택한 작업자 중 해당 작업조 소속이 아닌 사람이 있습니다." };
  }

  const nextSet = new Set(workers.map((worker) => worker.id));
  const removing = work.assignees.filter((assignee) => !nextSet.has(assignee.userId));
  const lockedRemoving = removing.filter((assignee) =>
    work.locks.some((lock) => lock.userId === assignee.userId),
  );
  if (lockedRemoving.length > 0) {
    return { error: "개인 시건을 걸어 둔 작업자는 투입 명단에서 제외할 수 없습니다." };
  }

  await prisma.$transaction([
    prisma.workAssignee.deleteMany({
      where: { workId: work.id, userId: { notIn: assigneeIds } },
    }),
    prisma.workAssignee.createMany({
      data: workers.map((worker) => ({ workId: work.id, userId: worker.id })),
      skipDuplicates: true,
    }),
  ]);
  revalidateTeams();
  return { ok: true, message: `투입 작업자 ${assigneeIds.length}명을 저장했습니다.` };
}
