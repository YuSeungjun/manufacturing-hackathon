"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertManager } from "@/lib/auth";
import { storeEvidence } from "@/lib/evidenceStore";

export type EquipmentState = null | { error: string } | { ok: true; message: string; id?: string };

function revalidateManager() {
  revalidatePath("/manager", "layout");
  revalidatePath("/operator", "layout");
}

const equipmentSchema = z.object({
  code: z.string().trim().min(1, "설비 번호를 입력해 주세요.").max(24),
  name: z.string().trim().min(1, "설비 이름을 입력해 주세요.").max(60),
  line: z.string().trim().max(60).default(""),
  kind: z.enum(["CONVEYOR", "ROLLING_MILL", "OTHER"]).default("CONVEYOR"),
  // 상한을 둔다. 오타로 0 하나 더 붙으면 발표 화면에 억 단위가 뜬다.
  downtimeCostPerMin: z.coerce.number().int().min(0).max(100_000_000).default(0),
});

export async function createEquipmentAction(
  _prev: EquipmentState,
  formData: FormData,
): Promise<EquipmentState> {
  const manager = await assertManager();
  const parsed = equipmentSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    line: formData.get("line") ?? "",
    kind: formData.get("kind") ?? "CONVEYOR",
    downtimeCostPerMin: formData.get("downtimeCostPerMin") ?? 0,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  }

  const exists = await prisma.equipment.findFirst({
    where: { workplaceId: manager.workplaceId, code: parsed.data.code },
  });
  if (exists) return { error: `설비 번호 ${parsed.data.code} 는 이미 등록되어 있습니다.` };

  const created = await prisma.equipment.create({
    data: { ...parsed.data, workplaceId: manager.workplaceId },
  });
  revalidateManager();
  return { ok: true, message: `${created.name} 을(를) 등록했습니다.`, id: created.id };
}

/**
 * 설비 종류와 분당 손실단가만 고친다.
 *
 * 단가를 우리가 추정하지 않는 이유 — 라인마다 시간당 생산량과 단가가 다르고, 틀린 금액
 * 하나가 나머지 지표의 신뢰까지 같이 깎는다. 비워 두면 화면에서 금액 칸이 사라진다.
 */
export async function updateEquipmentSettingsAction(
  _prev: EquipmentState,
  formData: FormData,
): Promise<EquipmentState> {
  const manager = await assertManager();
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const parsed = z
    .object({
      kind: z.enum(["CONVEYOR", "ROLLING_MILL", "OTHER"]),
      downtimeCostPerMin: z.coerce.number().int().min(0).max(100_000_000),
    })
    .safeParse({
      kind: formData.get("kind") ?? "CONVEYOR",
      downtimeCostPerMin: formData.get("downtimeCostPerMin") ?? 0,
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  }

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, workplaceId: manager.workplaceId },
  });
  if (!equipment) return { error: "설비를 찾을 수 없습니다." };

  await prisma.equipment.update({ where: { id: equipment.id }, data: parsed.data });
  revalidateManager();
  revalidatePath("/manager/patterns");
  return { ok: true, message: `${equipment.name} 설정을 저장했습니다.` };
}

/** 폴리곤 좌표는 화면에서 그려 hidden input 으로 넘어온다. 서버에서 다시 검증한다. */
const polygonSchema = z
  .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
  .min(3, "위험구역은 꼭짓점이 3개 이상이어야 합니다.")
  .max(64);

const zoneSchema = z.object({
  name: z.string().trim().min(1, "구역 이름을 입력해 주세요.").max(40),
  dwellThresholdSec: z.coerce.number().min(0.5).max(120),
  kind: z.enum(["PINCH", "ROTATING", "TRAVEL", "GENERAL"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  /// 체크하면 이 구역 사건에 "안전대 체결" 확정 칸이 열린다. AI 추정과 별개로 사람이 확정한다.
  requiresHarness: z.coerce.boolean().default(false),
});

export async function saveDangerZoneAction(
  _prev: EquipmentState,
  formData: FormData,
): Promise<EquipmentState> {
  const manager = await assertManager();
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const zoneId = String(formData.get("zoneId") ?? "");

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, workplaceId: manager.workplaceId },
    include: { cameras: true },
  });
  if (!equipment) return { error: "설비를 찾을 수 없습니다." };

  const fields = zoneSchema.safeParse({
    name: formData.get("name"),
    dwellThresholdSec: formData.get("dwellThresholdSec") ?? 5,
    kind: formData.get("kind") ?? "PINCH",
    severity: formData.get("severity") ?? "HIGH",
    requiresHarness: formData.get("requiresHarness") === "on",
  });
  if (!fields.success) {
    return { error: fields.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  }

  let polygon: [number, number][];
  try {
    polygon = polygonSchema.parse(JSON.parse(String(formData.get("polygon") ?? "[]")));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? "위험구역 좌표가 올바르지 않습니다." };
    }
    return { error: "위험구역 좌표를 읽지 못했습니다." };
  }

  const cameraId = String(formData.get("cameraId") ?? "") || equipment.cameras[0]?.id || null;
  const data = {
    equipmentId: equipment.id,
    cameraId,
    name: fields.data.name,
    polygon: JSON.stringify(polygon),
    dwellThresholdSec: fields.data.dwellThresholdSec,
    kind: fields.data.kind,
    severity: fields.data.severity,
    requiresHarness: fields.data.requiresHarness,
  };

  if (zoneId) {
    const zone = await prisma.dangerZone.findFirst({ where: { id: zoneId, equipmentId: equipment.id } });
    if (!zone) return { error: "위험구역을 찾을 수 없습니다." };
    await prisma.dangerZone.update({ where: { id: zone.id }, data });
  } else {
    const count = await prisma.dangerZone.count({ where: { equipmentId: equipment.id } });
    await prisma.dangerZone.create({ data: { ...data, order: count } });
  }

  revalidateManager();
  return { ok: true, message: `위험구역 "${fields.data.name}" 을(를) 저장했습니다.` };
}

export async function deleteDangerZoneAction(formData: FormData) {
  const manager = await assertManager();
  const zoneId = String(formData.get("zoneId") ?? "");
  const zone = await prisma.dangerZone.findFirst({
    where: { id: zoneId, equipment: { workplaceId: manager.workplaceId } },
  });
  if (!zone) throw new Error("위험구역을 찾을 수 없습니다.");

  // 이미 사건이 붙은 구역은 지우지 않고 끈다. 지우면 과거 근거가 함께 사라진다.
  const used = await prisma.riskEvent.count({ where: { zoneId: zone.id } });
  if (used > 0) {
    await prisma.dangerZone.update({ where: { id: zone.id }, data: { active: false } });
  } else {
    await prisma.dangerZone.delete({ where: { id: zone.id } });
  }
  revalidateManager();
}

/** 구역을 그릴 배경이 될 카메라 정지 프레임. */
export async function saveCameraPosterAction(
  _prev: EquipmentState,
  formData: FormData,
): Promise<EquipmentState> {
  const manager = await assertManager();
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const file = formData.get("poster");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "카메라 정지 프레임 이미지를 선택해 주세요." };
  }

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, workplaceId: manager.workplaceId },
    include: { cameras: true },
  });
  if (!equipment) return { error: "설비를 찾을 수 없습니다." };

  const posterPath = await storeEvidence(file, "posters");
  const cameraId = String(formData.get("cameraId") ?? "") || equipment.cameras[0]?.id;

  if (cameraId) {
    await prisma.cameraFeed.update({ where: { id: cameraId }, data: { posterPath } });
  } else {
    await prisma.cameraFeed.create({
      data: {
        workplaceId: manager.workplaceId,
        equipmentId: equipment.id,
        code: `CAM-${equipment.code}`,
        name: `${equipment.name} 카메라`,
        posterPath,
      },
    });
  }
  revalidateManager();
  return { ok: true, message: "카메라 화면을 등록했습니다. 이제 위험구역을 그릴 수 있습니다." };
}
