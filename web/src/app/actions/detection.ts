"use server";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertManager } from "@/lib/auth";
import { detectPpe, AiServiceError } from "@/lib/aiClient";
import { ppeLabel } from "@/lib/ppe";

export type AnalyzeState =
  | null
  | { error: string }
  | {
      ok: true;
      message: string;
      created: number;
      evidencePath: string;
      personCount: number;
      unlistedCodes: string[];
    };

const EVIDENCE_DIR = path.join(process.cwd(), "public", "evidence");

export async function analyzeFrameAction(
  _prev: AnalyzeState,
  formData: FormData,
): Promise<AnalyzeState> {
  const manager = await assertManager();

  const tbmId = String(formData.get("tbmId") ?? "");
  const file = formData.get("frame");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "분석할 현장 이미지를 선택해 주세요." };
  }

  const tbm = await prisma.tbm.findFirst({
    where: { id: tbmId, workplaceId: manager.workplaceId },
    include: { rules: true, team: true },
  });
  if (!tbm) return { error: "TBM을 찾을 수 없습니다." };

  let result;
  try {
    result = await detectPpe(file, Number(formData.get("conf") ?? 0.35));
  } catch (error) {
    return { error: error instanceof AiServiceError ? error.message : "AI 분석에 실패했습니다." };
  }

  // 근거 이미지는 판단 화면에서 다시 봐야 하므로 그대로 보관한다.
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const fileName = `${randomUUID()}.${extension.replace(/[^a-z0-9]/g, "") || "jpg"}`;
  await writeFile(path.join(EVIDENCE_DIR, fileName), Buffer.from(await file.arrayBuffer()));
  const evidencePath = `/evidence/${fileName}`;

  const location = String(formData.get("location") || tbm.workArea);
  const unlistedCodes: string[] = [];
  let created = 0;

  for (const code of result.violationCodes) {
    const boxes = result.boxes.filter((box) => box.code === code);
    const confidence = Math.max(...boxes.map((box) => box.confidence));
    const rule = tbm.rules.find((r) => r.ppeCode === code);
    if (!rule) unlistedCodes.push(code);

    await prisma.detection.create({
      data: {
        tbmId: tbm.id,
        safetyRuleId: rule?.id ?? null,
        ppeCode: code,
        location,
        source: "CCTV",
        evidencePath,
        confidence,
        boxes: JSON.stringify(result.boxes),
        status: "PENDING",
        modelRepo: result.modelRepo,
      },
    });
    created += 1;
  }

  // 레일의 단계별 숫자는 manager/layout.tsx 에서 계산된다.
  // type 없이 부르면 페이지만 갱신돼 레일이 옛날 숫자로 남는다.
  revalidatePath("/manager", "layout");
  revalidatePath("/worker");

  const message =
    created === 0
      ? `위반 의심 항목이 없습니다. (사람 ${result.personCount}명 인식)`
      : `${created}건의 위반 의심 항목을 검토 대기로 등록했습니다: ${result.violationCodes
          .map(ppeLabel)
          .join(", ")}`;

  return {
    ok: true,
    message,
    created,
    evidencePath,
    personCount: result.personCount,
    unlistedCodes,
  };
}

export async function reviewDetectionAction(formData: FormData) {
  // 위반 확정 / 오탐 판단은 안전관리자만 할 수 있다.
  const manager = await assertManager();

  const detectionId = String(formData.get("detectionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const comment = String(formData.get("comment") ?? "");

  if (!["CONFIRMED", "FALSE_POSITIVE", "HOLD"].includes(decision)) {
    throw new Error("올바르지 않은 판단 값입니다.");
  }

  const detection = await prisma.detection.findFirst({
    where: { id: detectionId, tbm: { workplaceId: manager.workplaceId } },
  });
  if (!detection) throw new Error("탐지 기록을 찾을 수 없습니다.");

  await prisma.$transaction([
    prisma.detection.update({ where: { id: detection.id }, data: { status: decision } }),
    prisma.review.upsert({
      where: { detectionId: detection.id },
      create: { detectionId: detection.id, reviewedById: manager.id, decision, comment },
      update: { reviewedById: manager.id, decision, comment, reviewedAt: new Date() },
    }),
  ]);

  revalidatePath("/manager", "layout");
  revalidatePath("/worker");
}
