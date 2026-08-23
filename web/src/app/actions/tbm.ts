"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertManager, getSessionUser } from "@/lib/auth";
import { dayRange, todayLocalISO } from "@/lib/date";
import { PPE_CODES, type PpeCode } from "@/lib/ppe";

const ruleSchema = z.object({
  hazard: z.string().min(1),
  description: z.string().min(1),
  detectionType: z.enum(["CCTV", "SENSOR", "MANUAL"]),
  ppeCode: z.string().optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

const tbmSchema = z.object({
  workDate: z.string().min(1, "작업일을 선택해 주세요."),
  workType: z.string().min(2, "작업 내용을 입력해 주세요."),
  teamId: z.string().min(1, "작업조를 선택해 주세요."),
  summary: z.string().default(""),
  rules: z.array(ruleSchema).min(1, "안전수칙을 최소 1개 이상 작성해 주세요."),
  // 그날 실제 투입되는 사람만 서명 대상이 된다. 작업조 전원이 자동으로 들어가지 않는다.
  assigneeIds: z.array(z.string()).min(1, "서명할 작업자를 한 명 이상 선택해 주세요."),
});

export type TbmFormState = { error?: string } | null;

export async function createTbmAction(
  _prev: TbmFormState,
  formData: FormData,
): Promise<TbmFormState> {
  // 서버에서 권한을 다시 확인한다.
  const manager = await assertManager();

  let rules: unknown;
  let assigneeIds: unknown;
  try {
    rules = JSON.parse(String(formData.get("rules") ?? "[]"));
    assigneeIds = JSON.parse(String(formData.get("assigneeIds") ?? "[]"));
  } catch {
    return { error: "입력 형식이 올바르지 않습니다." };
  }

  const parsed = tbmSchema.safeParse({
    workDate: formData.get("workDate"),
    workType: formData.get("workType"),
    teamId: formData.get("teamId"),
    summary: formData.get("summary") ?? "",
    rules,
    assigneeIds,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const team = await prisma.team.findFirst({
    where: { id: parsed.data.teamId, workplaceId: manager.workplaceId },
  });
  if (!team) return { error: "본인 사업장의 작업조만 선택할 수 있습니다." };

  // 화면에서 고른 사람이 정말 그 작업조의 작업자인지 서버에서 다시 확인한다.
  const assignees = await prisma.user.findMany({
    where: {
      id: { in: parsed.data.assigneeIds },
      teamId: team.id,
      role: "WORKER",
      approvalStatus: "APPROVED",
    },
    select: { id: true },
  });
  if (assignees.length !== parsed.data.assigneeIds.length) {
    return { error: "선택한 작업자 중 이 작업조에 속하지 않는 사람이 있습니다." };
  }

  const tbm = await prisma.tbm.create({
    data: {
      workDate: new Date(`${parsed.data.workDate}T00:00:00`),
      workType: parsed.data.workType,
      workArea: team.workArea,
      summary: parsed.data.summary,
      createdById: manager.id,
      workplaceId: manager.workplaceId,
      teamId: team.id,
      assignees: { create: assignees.map((u) => ({ userId: u.id })) },
      rules: {
        create: parsed.data.rules.map((rule, index) => {
          const ppeCode =
            rule.ppeCode && rule.ppeCode in PPE_CODES ? (rule.ppeCode as PpeCode) : null;
          return {
            hazard: rule.hazard,
            description: rule.description,
            detectionType: rule.detectionType,
            ppeCode,
            severity: rule.severity,
            penalty: ppeCode ? PPE_CODES[ppeCode].defaultPenalty : rule.severity === "HIGH" ? 20 : 10,
            order: index + 1,
          };
        }),
      },
    },
  });

  // 레일의 단계별 숫자는 manager/layout.tsx 에서 계산된다.
  // type 없이 부르면 페이지만 갱신돼 레일이 옛날 숫자로 남는다.
  revalidatePath("/manager", "layout");
  revalidatePath("/worker");
  redirect(`/manager/tbm/${tbm.id}`);
}

export async function acknowledgeTbmAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) throw new Error("로그인이 필요합니다.");

  const tbmId = String(formData.get("tbmId") ?? "");
  const tbm = await prisma.tbm.findUnique({ where: { id: tbmId } });
  // 본인 작업조의 TBM만 서명할 수 있다.
  if (!tbm || tbm.teamId !== user.teamId) {
    throw new Error("본인에게 배정된 TBM이 아닙니다.");
  }

  // 배정된 사람만 서명한다. 같은 조라도 그날 투입되지 않았으면 대상이 아니다.
  const assigned = await prisma.tbmAssignee.findUnique({
    where: { tbmId_userId: { tbmId, userId: user.id } },
  });
  if (!assigned) throw new Error("이 TBM의 서명 대상이 아닙니다.");

  // 서명은 작업 전에 하는 것이다. 지난 날짜를 소급해서 채우지 못하게 막는다.
  // 화면에서 버튼을 숨기는 것과 별개로 서버에서 한 번 더 확인한다.
  const { from, to } = dayRange(todayLocalISO());
  if (tbm.workDate < from || tbm.workDate >= to) {
    throw new Error("오늘 작업일의 TBM만 서명할 수 있습니다.");
  }

  await prisma.tbmAcknowledgement.upsert({
    where: { tbmId_userId: { tbmId, userId: user.id } },
    create: { tbmId, userId: user.id },
    update: {},
  });

  revalidatePath("/worker");
  revalidatePath("/manager", "layout");
}
