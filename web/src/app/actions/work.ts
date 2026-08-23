"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertManager, getSessionUser } from "@/lib/auth";
import { logStateChange } from "@/lib/interlock";
import { isoDateToInstant, todayLocalISO } from "@/lib/date";

export type WorkState = null | { error: string } | { ok: true; message: string; id: string };

function revalidateAll() {
  revalidatePath("/manager", "layout");
  revalidatePath("/operator", "layout");
  revalidatePath("/worker");
}

const workSchema = z.object({
  title: z.string().trim().min(1, "작업 이름을 입력해 주세요.").max(80),
  summary: z.string().trim().max(500).default(""),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "작업일을 확인해 주세요."),
});

/** 정비 작업을 열면 설비는 정비 상태로 들어가고 인터록이 걸린다. */
export async function createMaintenanceWorkAction(
  _prev: WorkState,
  formData: FormData,
): Promise<WorkState> {
  const manager = await assertManager();
  const parsed = workSchema.safeParse({
    title: formData.get("title"),
    summary: formData.get("summary") ?? "",
    workDate: formData.get("workDate") ?? todayLocalISO(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  }

  const equipmentId = String(formData.get("equipmentId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const assigneeIds = formData.getAll("assigneeIds").map(String).filter(Boolean);

  const [equipment, team] = await Promise.all([
    prisma.equipment.findFirst({ where: { id: equipmentId, workplaceId: manager.workplaceId } }),
    prisma.team.findFirst({ where: { id: teamId, workplaceId: manager.workplaceId } }),
  ]);
  if (!equipment) return { error: "설비를 찾을 수 없습니다." };
  if (!team) return { error: "작업조를 찾을 수 없습니다." };
  if (assigneeIds.length === 0) return { error: "투입 작업자를 한 명 이상 선택해 주세요." };

  // 화면에서 고른 사람이 정말 그 조 소속 작업자인지 서버에서 다시 확인한다
  const assignees = await prisma.user.findMany({
    where: { id: { in: assigneeIds }, teamId: team.id, role: "WORKER", workplaceId: manager.workplaceId },
    select: { id: true },
  });
  if (assignees.length !== assigneeIds.length) {
    return { error: "선택한 작업자 중 이 작업조 소속이 아닌 사람이 있습니다." };
  }

  const work = await prisma.maintenanceWork.create({
    data: {
      workDate: isoDateToInstant(parsed.data.workDate),
      title: parsed.data.title,
      summary: parsed.data.summary,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      equipmentId: equipment.id,
      workplaceId: manager.workplaceId,
      teamId: team.id,
      createdById: manager.id,
      assignees: { create: assignees.map((a) => ({ userId: a.id })) },
    },
  });

  await prisma.equipment.update({
    where: { id: equipment.id },
    data: {
      runState: "MAINTENANCE",
      interlock: "BLOCKED",
      interlockReason: `정비 작업 진행 중 — ${work.title}`,
      interlockedAt: new Date(),
    },
  });
  await logStateChange(equipment.id, equipment.runState, "MAINTENANCE", "MAINTENANCE", manager.id, work.title);

  revalidateAll();
  return { ok: true, message: `"${work.title}" 정비 작업을 열었습니다.`, id: work.id };
}

/** 개인 시건. 본인만 걸고 본인만 푼다 — 관리자도 대신 못 한다. */
export async function lockLotoAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  const workId = String(formData.get("workId") ?? "");

  const assigned = await prisma.workAssignee.findFirst({ where: { workId, userId: user.id } });
  if (!assigned) throw new Error("이 정비 작업에 배정된 작업자만 시건할 수 있습니다.");

  await prisma.lotoLock.upsert({
    where: { workId_userId: { workId, userId: user.id } },
    create: { workId, userId: user.id },
    update: { lockedAt: new Date(), releasedAt: null },
  });
  revalidateAll();
}

export async function releaseLotoAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  const workId = String(formData.get("workId") ?? "");

  const lock = await prisma.lotoLock.findFirst({ where: { workId, userId: user.id, releasedAt: null } });
  if (!lock) throw new Error("해제할 시건이 없습니다.");

  await prisma.lotoLock.update({ where: { id: lock.id }, data: { releasedAt: new Date() } });

  // 전원이 풀렸으면 작업을 닫는다. 인터록은 여기서 풀지 않는다 —
  // 해제는 관리자가 현장을 확인하고 내리는 조치다.
  const remaining = await prisma.lotoLock.count({ where: { workId, releasedAt: null } });
  if (remaining === 0) {
    await prisma.maintenanceWork.update({
      where: { id: workId },
      data: { status: "COMPLETED", endedAt: new Date() },
    });
  }
  revalidateAll();
}
