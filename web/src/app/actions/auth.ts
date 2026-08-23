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
  role: z.enum(["WORKER", "SAFETY_MANAGER"]),
});

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    employeeNumber: formData.get("employeeNumber"),
    password: formData.get("password"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  /**
   * 사업장은 묻지 않고 등록된 것에 붙인다.
   *
   * 가입 화면에서 소속을 고르게 하면 아무나 아무 사업장을 고를 수 있고, 그건 소속 확인이
   * 아니라 소속 자기신고다. 실제 확인은 안전관리자의 승인에서 일어난다.
   */
  const workplace = await prisma.workplace.findFirst({ orderBy: { name: "asc" } });
  if (!workplace) return { error: "등록된 사업장이 없습니다. 관리자에게 문의해 주세요." };

  const duplicated = await prisma.user.findUnique({
    where: { employeeNumber: input.employeeNumber },
  });
  if (duplicated) return { error: "이미 가입된 사번입니다." };

  /**
   * 가입하면 고른 역할의 권한을 바로 준다.
   *
   * 승인 단계를 두면 승인해 줄 사람이 먼저 있어야 하고, 첫 안전관리자를 만들 방법이
   * 없어진다. 사내망 안에서 사번으로 가입하는 시스템이라 가입 자체가 1차 관문이다.
   *
   * 승인 대기(PENDING)는 상태로 남아 있고 현황판의 승인 화면도 그대로다 —
   * 이전에 대기로 남은 계정과, 나중에 승인 절차를 다시 켤 때를 위해서다.
   */
  const approvalStatus = "APPROVED";

  const user = await prisma.user.create({
    data: {
      name: input.name,
      employeeNumber: input.employeeNumber,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: input.role,
      approvalStatus,
      workplaceId: workplace.id,
      // 작업조는 가입 때 고르지 않는다. 안전관리자가 조 설정에서 배정한다 —
      // 누가 어느 조인지는 본인 신고가 아니라 관리가 정하는 일이다.
      teamId: null,
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
