import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storeEvidence } from "@/lib/evidenceStore";
import { detectSnapshot } from "@/lib/snapshotDetect";
import { parsePolygon } from "@/lib/zone";

/**
 * 카메라·엣지 장치가 스냅샷을 밀어 넣는 자리.
 *
 * 화면의 "수신 시뮬레이션" 은 데모용이고 이쪽이 실제 경로다. 이 라우트가 있어야
 * "실운영에서는 엣지 장치가 POST 한다" 가 바람이 아니라 사실이 된다.
 *
 * 사람 세션이 아니라 장치 토큰으로 인증한다 — 카메라는 로그인하지 않는다.
 *
 *   curl -X POST http://localhost:3000/api/snapshots \
 *     -H "Authorization: Bearer $CAMERA_INGEST_TOKEN" \
 *     -F "cameraCode=CAM-CV01-E" \
 *     -F "capturedAt=2026-08-23T14:32:07+09:00" \
 *     -F "trigger=ZONE_APPROACH" \
 *     -F "note=위험구역 접근 감지" \
 *     -F "file=@frame.jpg"
 */

const TRIGGERS = new Set(["ZONE_APPROACH", "MOTION", "SCHEDULE", "MANUAL"]);

/** 전용 토큰이 없으면 AI 서비스 토큰을 같이 쓴다. 둘 다 없으면 로컬 개발로 보고 열어 둔다. */
function authorized(request: Request): boolean {
  const expected = process.env.CAMERA_INGEST_TOKEN || process.env.AI_SERVICE_TOKEN || "";
  if (!expected) return true;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "인증되지 않은 장치입니다." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data 로 보내 주세요." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file 필드에 이미지가 필요합니다." }, { status: 400 });
  }

  const cameraCode = String(form.get("cameraCode") ?? "").trim();
  if (!cameraCode) {
    return NextResponse.json({ error: "cameraCode 가 필요합니다." }, { status: 400 });
  }

  const camera = await prisma.cameraFeed.findFirst({
    where: { code: cameraCode },
    include: {
      equipment: {
        include: { zones: { where: { active: true }, orderBy: { order: "asc" } } },
      },
    },
  });
  if (!camera) {
    return NextResponse.json(
      { error: `카메라 ${cameraCode} 가 등록되지 않았습니다.` },
      { status: 404 },
    );
  }

  // 장치가 시각을 준다. 없으면 도착 시각으로 둔다 — 추측해서 만들지 않는다.
  const rawCapturedAt = String(form.get("capturedAt") ?? "");
  const parsed = rawCapturedAt ? new Date(rawCapturedAt) : null;
  if (rawCapturedAt && (!parsed || Number.isNaN(parsed.getTime()))) {
    return NextResponse.json(
      { error: "capturedAt 을 읽지 못했습니다. ISO 8601 로 보내 주세요." },
      { status: 400 },
    );
  }
  const capturedAt = parsed ?? new Date();

  const trigger = String(form.get("trigger") ?? "ZONE_APPROACH");
  if (!TRIGGERS.has(trigger)) {
    return NextResponse.json(
      { error: `trigger 는 ${[...TRIGGERS].join(" | ")} 중 하나여야 합니다.` },
      { status: 400 },
    );
  }

  let imagePath: string;
  try {
    imagePath = await storeEvidence(file, "snapshots");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "이미지를 저장하지 못했습니다." },
      { status: 500 },
    );
  }

  // "접근했다" 는 말과 함께 그 근거를 붙인다. 실패해도 수신은 성공한다 —
  // AI 가 재시작 중이라고 카메라가 보낸 장면을 잃어버리면 안 된다.
  const detection = await detectSnapshot(
    file,
    (camera.equipment?.zones ?? []).map((zone) => ({
      id: zone.id,
      name: zone.name,
      polygon: parsePolygon(zone.polygon),
      kind: zone.kind,
      dwellWarnSec: zone.dwellThresholdSec,
    })),
  );

  const snapshot = await prisma.cameraSnapshot.create({
    data: {
      workplaceId: camera.workplaceId,
      cameraId: camera.id,
      equipmentId: camera.equipmentId,
      imagePath,
      capturedAt,
      trigger,
      note: String(form.get("note") ?? "").slice(0, 200),
      width: Number(form.get("width")) || 0,
      height: Number(form.get("height")) || 0,
      ...detection,
    },
  });

  return NextResponse.json({
    id: snapshot.id,
    cameraCode,
    capturedAt: snapshot.capturedAt.toISOString(),
    trigger: snapshot.trigger,
    imagePath: snapshot.imagePath,
    // 장치가 자기 판단을 우리 탐지와 맞춰 볼 수 있게 돌려준다
    personCount: snapshot.personCount,
    zoneOccupancy: JSON.parse(snapshot.zoneOccupancy),
    detected: snapshot.detectedAt != null,
  });
}
