"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession, homePathFor } from "@/lib/auth";

export type FormState = { error?: string } | null;

const signupSchema = z.object({
  name: z.string().min(2, "이름을 입력해 주세요."),
  employeeNumber: z.string().min(3, "사번을 정확히 입력해 주세요."),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다."),
  workplaceId: z.string().min(1, "소속 사업장을 선택해 주세요."),
  teamId: z.string().min(1, "부서 또는 작업조를 선택해 주세요."),
  role: z.enum(["WORKER", "SAFETY_MANAGER"]),
  managerCode: z.string().optional(),
});

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    employeeNumber: formData.get("employeeNumber"),
    password: formData.get("password"),
    workplaceId: formData.get("workplaceId"),
    teamId: formData.get("teamId"),
    role: formData.get("role"),
    managerCode: formData.get("managerCode") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  const workplace = await prisma.workplace.findUnique({ where: { id: input.workplaceId } });
  if (!workplace) return { error: "선택한 사업장을 찾을 수 없습니다." };

  const team = await prisma.team.findFirst({
    where: { id: input.teamId, workplaceId: workplace.id },
  });
  if (!team) return { error: "선택한 작업조가 해당 사업장에 없습니다." };

  const duplicated = await prisma.user.findUnique({
    where: { employeeNumber: input.employeeNumber },
  });
  if (duplicated) return { error: "이미 가입된 사번입니다." };

  // 안전관리자 권한은 가입만으로 주지 않는다.
  // 사업장 인증번호가 맞으면 즉시 승인, 아니면 승인 대기 상태로 만든다.
  let approvalStatus = "APPROVED";
  if (input.role === "SAFETY_MANAGER") {
    const codeMatches =
      !!input.managerCode && input.managerCode.trim() === workplace.managerCode;
    approvalStatus = codeMatches ? "APPROVED" : "PENDING";
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      employeeNumber: input.employeeNumber,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: input.role,
      approvalStatus,
      workplaceId: workplace.id,
      teamId: team.id,
    },
  });

  await createSession(user.id);
  // 세션이 바뀌었다. 앞 사용자 기준으로 그려 둔 화면이 남지 않게 전부 무효화한다.
  revalidatePath("/", "layout");
  redirect(homePathFor(user));
}

const loginSchema = z.object({
  employeeNumber: z.string().min(1, "사번을 입력해 주세요."),
  password: z.string().min(1, "비밀번호를 입력해 주세요."),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    employeeNumber: formData.get("employeeNumber"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await prisma.user.findUnique({
    where: { employeeNumber: parsed.data.employeeNumber.trim() },
  });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return { error: "사번 또는 비밀번호가 올바르지 않습니다." };
  }
  if (user.approvalStatus === "REJECTED") {
    return { error: "가입이 반려된 계정입니다. 안전관리팀에 문의해 주세요." };
  }

  await createSession(user.id);
  revalidatePath("/", "layout");
  redirect(homePathFor(user));
}

export async function logoutAction() {
  await destroySession();
  revalidatePath("/", "layout");
  redirect("/login");
}
