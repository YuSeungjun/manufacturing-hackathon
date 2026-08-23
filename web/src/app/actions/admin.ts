"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertManager } from "@/lib/auth";

/** 안전관리자 가입 승인 / 반려. 승인된 안전관리자만 처리할 수 있다. */
export async function decideManagerApprovalAction(formData: FormData) {
  const manager = await assertManager();

  const userId = String(formData.get("userId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw new Error("올바르지 않은 승인 값입니다.");
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, workplaceId: manager.workplaceId, approvalStatus: "PENDING" },
  });
  if (!target) throw new Error("승인 대기 중인 사용자가 아닙니다.");

  await prisma.user.update({ where: { id: target.id }, data: { approvalStatus: decision } });
  // 레일의 단계별 숫자는 manager/layout.tsx 에서 계산된다.
  // type 없이 부르면 페이지만 갱신돼 레일이 옛날 숫자로 남는다.
  revalidatePath("/manager", "layout");
}
