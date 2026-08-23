import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { isoDateToInstant, shiftIsoDate, todayLocalISO } from "../src/lib/date";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  }),
});

/** 작업일은 현장 시간대(Asia/Seoul) 기준이다. 서버 로컬 시간을 쓰면 UTC 환경에서 하루 밀린다. */
const TODAY = todayLocalISO();
const WORK_DATE = isoDateToInstant(TODAY);

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000);
}

/**
 * 시드 스냅샷에 1차 탐지를 붙인다.
 *
 * 수신함 썸네일에 사람 박스가 보이려면 이 값이 있어야 한다. AI 서비스가 안 떠 있으면
 * 조용히 건너뛴다 — 시드가 실패하면 아무것도 못 하는데, 박스가 없어도 나머지는 다 된다.
 * `detectedAt` 이 비어 있으면 화면이 "탐지 안 됨" 으로 정직하게 표시한다.
 */
async function detectSeedFrame(
  filePath: string,
  zones: { id: string; name: string; polygon: string; kind: string; dwellThresholdSec: number }[],
) {
  const empty = {
    personCount: 0,
    boxes: "[]",
    zoneOccupancy: "{}",
    riskLevel: "SAFE",
    modelRepo: "",
    detectedAt: null as Date | null,
  };
  const base = process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000";
  try {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(filePath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "frame.jpg");
    form.append("conf", "0.25");
    form.append("machineState", "STOPPED");
    form.append(
      "zones",
      JSON.stringify(
        zones.map((zone) => ({
          id: zone.id,
          name: zone.name,
          polygon: JSON.parse(zone.polygon),
          kind: zone.kind,
          dwellWarnSec: zone.dwellThresholdSec,
        })),
      ),
    );
    const headers: Record<string, string> = {};
    if (process.env.AI_SERVICE_TOKEN) headers.Authorization = `Bearer ${process.env.AI_SERVICE_TOKEN}`;

    const response = await fetch(`${base}/analyze/frame`, { method: "POST", headers, body: form });
    if (!response.ok) return empty;
    const result = (await response.json()) as {
      model: string;
      personCount: number;
      occupancy: Record<string, number>;
      persons: unknown[];
      riskLevel: string;
    };
    return {
      personCount: result.personCount,
      boxes: JSON.stringify(result.persons),
      zoneOccupancy: JSON.stringify(result.occupancy),
      riskLevel: result.riskLevel,
      modelRepo: result.model,
      detectedAt: new Date(),
    };
  } catch {
    return empty;
  }
}

/**
 * 최근 30일 정지 이력.
 *
 * 난수를 쓰면 시드를 돌릴 때마다 발표 숫자가 바뀐다. 고정 시드 LCG 로 항상 같은 표를
 * 만든다 — 데모에서 "어제 본 숫자와 다른데요" 가 나오면 그 자리에서 신뢰를 잃는다.
 */
let lcg = 20260823;
function rand() {
  lcg = (lcg * 1_103_515_245 + 12_345) % 2_147_483_648;
  return lcg / 2_147_483_648;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

type HistorySpec = {
  equipmentId: string;
  /** 걸림 대응 정지 횟수 */
  jams: number;
  /** 그중 위험구역 접근이 동반된 횟수 */
  approaches: number;
  /** 복구시간 범위(초) */
  recoveryRange: [number, number];
  /** 걸림이 몰리는 현장 시간대 */
  hours: number[];
  /** 계획 정비 횟수 */
  maintenance?: number;
};

/** 며칠 전 몇 시 몇 분. 현장 시간대(Asia/Seoul) 자정에서 더한다. */
function siteInstant(daysAgo: number, hour: number, minute: number) {
  const base = isoDateToInstant(shiftIsoDate(todayLocalISO(), -daysAgo));
  return new Date(base.getTime() + hour * 3_600_000 + minute * 60_000);
}

async function seedStoppageHistory(workplaceId: string, specs: HistorySpec[]) {
  const rows: {
    workplaceId: string;
    equipmentId: string;
    cause: string;
    source: string;
    startedAt: Date;
    restartedAt: Date;
    recoverySec: number;
    riskApproach: boolean;
    approachCount: number;
    approachDwellSec: number;
  }[] = [];

  for (const spec of specs) {
    const [low, high] = spec.recoveryRange;

    for (let i = 0; i < spec.jams; i += 1) {
      // 접근 동반 여부는 앞쪽 i 개에 몰아 준다. 무작위로 뿌리면 요청한 비율이 안 맞는다.
      const approached = i < spec.approaches;
      const recoverySec = Math.round(low + rand() * (high - low));
      const startedAt = siteInstant(
        1 + Math.floor(rand() * 29),
        pick(spec.hours),
        Math.floor(rand() * 60),
      );
      rows.push({
        workplaceId,
        equipmentId: spec.equipmentId,
        cause: "JAM",
        source: "PLC",
        startedAt,
        restartedAt: new Date(startedAt.getTime() + recoverySec * 1000),
        recoverySec,
        riskApproach: approached,
        approachCount: approached ? 1 + Math.floor(rand() * 2) : 0,
        // 접근이 있었던 건만 체류시간이 있다. 없는 건에 0 이 아닌 값을 넣으면 거짓이 된다.
        approachDwellSec: approached ? Math.round((6 + rand() * 26) * 10) / 10 : 0,
      });
    }

    for (let i = 0; i < (spec.maintenance ?? 0); i += 1) {
      const recoverySec = Math.round(low + rand() * (high - low));
      const startedAt = siteInstant(2 + i * 9, pick(spec.hours), Math.floor(rand() * 60));
      rows.push({
        workplaceId,
        equipmentId: spec.equipmentId,
        cause: "MAINTENANCE",
        source: "PLC",
        startedAt,
        restartedAt: new Date(startedAt.getTime() + recoverySec * 1000),
        recoverySec,
        riskApproach: false,
        approachCount: 0,
        approachDwellSec: 0,
      });
    }
  }

  await prisma.stoppageEpisode.createMany({ data: rows });

  return {
    total: rows.length,
    jams: rows.filter((r) => r.cause === "JAM").length,
    approaches: rows.filter((r) => r.riskApproach).length,
  };
}

async function main() {
  // FK 역순으로 지운다
  await prisma.review.deleteMany();
  await prisma.restartRequest.deleteMany();
  await prisma.riskEvent.deleteMany();
  await prisma.stoppageEpisode.deleteMany();
  await prisma.cameraSnapshot.deleteMany();
  await prisma.videoAnalysis.deleteMany();
  await prisma.equipmentStateLog.deleteMany();
  await prisma.lotoLock.deleteMany();
  await prisma.workAssignee.deleteMany();
  await prisma.maintenanceWork.deleteMany();
  await prisma.dangerZone.deleteMany();
  await prisma.cameraFeed.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.user.deleteMany();
  await prisma.team.deleteMany();
  await prisma.workplace.deleteMany();

  const gwangyang = await prisma.workplace.create({
    data: { name: "광양제철소", managerCode: "GY-SAFETY-2026" },
  });
  const pohang = await prisma.workplace.create({
    data: { name: "포항제철소", managerCode: "PH-SAFETY-2026" },
  });

  const teams = await Promise.all(
    [
      { name: "소결 정비 1조", workArea: "소결공장 원료이송", workplaceId: gwangyang.id },
      { name: "소결 정비 2조", workArea: "소결공장 코크스이송", workplaceId: gwangyang.id },
      { name: "열연 정비 3조", workArea: "열연공장 조압연", workplaceId: gwangyang.id },
      { name: "소결 정비 1조", workArea: "소결공장 원료이송", workplaceId: pohang.id },
    ].map((data) => prisma.team.create({ data })),
  );
  const [team1, team2] = teams;

  const password = await bcrypt.hash("test1234", 10);

  const manager = await prisma.user.create({
    data: {
      employeeNumber: "M0001", name: "김안전", passwordHash: password,
      role: "SAFETY_MANAGER", approvalStatus: "APPROVED", workplaceId: gwangyang.id,
    },
  });
  const operator = await prisma.user.create({
    data: {
      employeeNumber: "O2001", name: "한운전", passwordHash: password,
      role: "OPERATOR", approvalStatus: "APPROVED", workplaceId: gwangyang.id, teamId: team1.id,
    },
  });
  const [worker1, worker2] = await Promise.all(
    [
      { employeeNumber: "W1001", name: "박정비", teamId: team1.id },
      { employeeNumber: "W1002", name: "이현장", teamId: team1.id },
      { employeeNumber: "W1003", name: "최이송", teamId: team2.id },
    ].map((u) =>
      prisma.user.create({
        data: { ...u, passwordHash: password, role: "WORKER", workplaceId: gwangyang.id },
      }),
    ),
  );

  // ── 설비 ─────────────────────────────────────────────
  // 컨베이어를 앞에 세우되 압연설비도 남긴다. 서비스 범위는 "제철소 이송·회전설비 끼임" 이고
  // 인터록 구조 자체는 설비 종류와 무관하게 같다.
  const cv01 = await prisma.equipment.create({
    data: {
      code: "CV-01", name: "원료 이송 컨베이어 1호", line: "소결 1라인",
      kind: "CONVEYOR", downtimeCostPerMin: 42_000,
      workplaceId: gwangyang.id, runState: "MAINTENANCE", interlock: "BLOCKED",
      interlockReason: "이물 제거 작업 진행 중 — 개인 시건 2건 미해제",
      interlockedAt: minutesAgo(95),
    },
  });
  const cv02 = await prisma.equipment.create({
    data: {
      code: "CV-02", name: "원료 이송 컨베이어 2호", line: "소결 1라인",
      kind: "CONVEYOR", downtimeCostPerMin: 42_000,
      workplaceId: gwangyang.id, runState: "RUNNING", interlock: "CLEAR",
    },
  });
  const cv07 = await prisma.equipment.create({
    data: {
      code: "CV-07", name: "코크스 이송 컨베이어 7호", line: "소결 2라인",
      kind: "CONVEYOR", downtimeCostPerMin: 35_000,
      workplaceId: gwangyang.id, runState: "RUNNING", interlock: "CLEAR",
    },
  });
  const rm02 = await prisma.equipment.create({
    data: {
      code: "RM-02", name: "조압연기 2호", line: "열연 1라인",
      kind: "ROLLING_MILL", downtimeCostPerMin: 180_000,
      workplaceId: gwangyang.id, runState: "RUNNING", interlock: "CLEAR",
    },
  });

  const camera = await prisma.cameraFeed.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: cv01.id,
      code: "CAM-CV01-E", name: "원료 컨베이어 1호 동측",
      purpose: "PINCH",
      posterPath: "/scenes/seed-cv01-east.jpg",
    },
  });
  await prisma.cameraFeed.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: cv02.id,
      code: "CAM-CV02-E", name: "원료 컨베이어 2호 동측", purpose: "PINCH",
      posterPath: "/scenes/seed-cv02-east.jpg",
    },
  });

  // 카메라가 없으면 위험구역 화면에 배경이 없어 구역을 그릴 수가 없다.
  // 나머지 설비에도 장면을 붙여 어느 설비를 열어도 화면이 서게 한다.
  await prisma.cameraFeed.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: cv07.id,
      code: "CAM-CV07-E", name: "코크스 컨베이어 7호 동측", purpose: "PINCH",
      posterPath: "/scenes/seed-cv02-east.jpg",
    },
  });
  await prisma.cameraFeed.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: rm02.id,
      code: "CAM-RM02", name: "조압연기 2호 입측", purpose: "PINCH",
      posterPath: "/scenes/seed-cv01-east.jpg",
    },
  });

  // 컨베이어의 끼임은 벨트가 아니라 풀리에서 난다. 회전체 세 곳을 구역으로 잡는다.
  //
  // 좌표를 감으로 찍지 않았다. samples/ 의 CAM 05 화면에 겹쳐 보고 설비 위치에 맞췄다.
  // 폴리곤은 카메라 화각에 종속되므로 카메라 화면을 바꾸면 다시 그려야 한다 —
  // 그래서 DangerZone 이 cameraId 를 들고 있고, 사건에는 판정 당시 폴리곤이 함께 저장된다.
  const drivePulley = await prisma.dangerZone.create({
    data: {
      equipmentId: cv01.id, cameraId: camera.id, name: "구동 풀리 하부",
      polygon: JSON.stringify([[0.34, 0.58], [0.58, 0.52], [0.60, 0.76], [0.36, 0.80]]),
      dwellThresholdSec: 5, kind: "PINCH", severity: "HIGH", order: 0,
    },
  });
  await prisma.dangerZone.create({
    data: {
      equipmentId: cv01.id, cameraId: camera.id, name: "롤러 구간 측면",
      polygon: JSON.stringify([[0.62, 0.20], [0.78, 0.16], [0.74, 0.44], [0.60, 0.48]]),
      dwellThresholdSec: 5, kind: "ROTATING", severity: "HIGH", order: 1,
    },
  });
  // 안전대 확인이 붙는 구역. 진입과 착용은 AI 가 보고 체결은 사람이 증언한다.
  // 벨트 상판을 덮는다 — CAM 05 에서 작업자가 무릎을 꿇고 있는 바로 그 면이다.
  const deck = await prisma.dangerZone.create({
    data: {
      equipmentId: cv01.id, cameraId: camera.id, name: "벨트 상부 점검대",
      polygon: JSON.stringify([[0.47, 0.30], [0.72, 0.22], [0.68, 0.50], [0.46, 0.58]]),
      dwellThresholdSec: 8, kind: "TRAVEL", severity: "HIGH",
      requiresHarness: true, order: 2,
    },
  });

  // ── 고소 점검통로 (안전대 전용 화각) ────────────────
  //
  // 컨베이어(CAM 05)와 다른 카메라다. 위험구역 폴리곤은 화각에 종속되므로 한 카메라의
  // 구역을 다른 화각에 얹으면 엉뚱한 자리에 사각형이 뜬다. 그래서 설비·카메라·구역을
  // 따로 만든다 — 안전대 판정은 이 화각에서만 한다.
  const deckWork = await prisma.equipment.create({
    data: {
      code: "WK-01", name: "3고로 상부 점검통로", line: "제선 3고로",
      kind: "OTHER", downtimeCostPerMin: 0,
      workplaceId: gwangyang.id, runState: "RUNNING", interlock: "CLEAR",
    },
  });
  const deckCamera = await prisma.cameraFeed.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: deckWork.id,
      code: "CAM-07", name: "3고로 상부 점검통로",
      purpose: "FALL",
      posterPath: "/scenes/seed-cam07.jpg",
    },
  });
  // 작업자 접지점을 실측해 맞췄다 — (0.366, 0.770) / (0.358, 0.801).
  const walkway = await prisma.dangerZone.create({
    data: {
      equipmentId: deckWork.id, cameraId: deckCamera.id, name: "점검통로 난간부",
      polygon: JSON.stringify([[0.18, 0.66], [0.50, 0.70], [0.48, 0.95], [0.14, 0.90]]),
      dwellThresholdSec: 10, kind: "TRAVEL", severity: "HIGH",
      requiresHarness: true, order: 0,
    },
  });

  // ── CCTV 가 찍어 둔 장면 (수신함) ─────────────────────
  //
  // 실운영에서는 카메라·엣지 장치가 POST /api/snapshots 로 밀어 넣는다. 시드는 수신함이
  // 빈 화면으로 시작하지 않게 samples/ 의 실제 사진을 넣는 것이다.
  //
  // 같은 사진을 여러 장으로 복제하지 않는다. 한 장을 다섯 개로 늘리면 수신함은 채워지지만
  // 프레임마다 판정이 똑같이 나와서 "시퀀스" 라고 부를 수 없다. 있는 사진만 넣는다.
  const seedZones = await prisma.dangerZone.findMany({
    where: { equipmentId: cv01.id, active: true },
    orderBy: { order: "asc" },
  });

  const snapshotPlan: {
    file: string;
    cameraId: string;
    equipmentId: string;
    zones: typeof seedZones;
    minutes: number;
    note: string;
  }[] = [
    {
      file: "/scenes/seed-cv01-east.jpg",
      cameraId: camera.id, equipmentId: cv01.id, zones: seedZones,
      minutes: 42, note: "원료 걸림 — 벨트 상부에 작업자 진입",
    },
    {
      file: "/scenes/seed-cam07.jpg",
      cameraId: deckCamera.id, equipmentId: deckWork.id, zones: [walkway],
      minutes: 41.5, note: "점검통로 난간부 진입 — 안전대 미착용 의심",
    },
    {
      file: "/scenes/seed-cam07-harness.jpg",
      cameraId: deckCamera.id, equipmentId: deckWork.id, zones: [walkway],
      minutes: 41, note: "점검통로 난간부 진입 — 안전대 착용",
    },
  ];

  const snapshotRows = [];
  for (const item of snapshotPlan) {
    const detection = await detectSeedFrame(`${process.cwd()}/public${item.file}`, item.zones);
    snapshotRows.push({
      workplaceId: gwangyang.id,
      cameraId: item.cameraId,
      equipmentId: item.equipmentId,
      imagePath: item.file,
      capturedAt: minutesAgo(item.minutes),
      width: 1448,
      height: 1086,
      trigger: "ZONE_APPROACH",
      note: item.note,
      ...detection,
    });
  }
  await prisma.cameraSnapshot.createMany({ data: snapshotRows });
  const seedDetected = snapshotRows.filter((r) => r.detectedAt != null).length;

  // ── 정비 작업과 개인 시건 ─────────────────────────────
  const work = await prisma.maintenanceWork.create({
    data: {
      workDate: WORK_DATE, title: "원료 컨베이어 1호 구동 풀리 이물 제거",
      summary: "원료 걸림으로 벨트 정지. 구동 풀리 하부 이물 제거 후 재가동. 작업 중 재가동 금지.",
      status: "IN_PROGRESS", startedAt: minutesAgo(95),
      equipmentId: cv01.id, workplaceId: gwangyang.id, teamId: team1.id,
      createdById: manager.id,
      assignees: { create: [{ userId: worker1.id }, { userId: worker2.id }] },
      locks: {
        create: [
          { userId: worker1.id, lockedAt: minutesAgo(92) },
          { userId: worker2.id, lockedAt: minutesAgo(90) },
        ],
      },
    },
  });

  // ── 지금 진행 중인 정지 에피소드 ──────────────────────
  // 재가동 전이라 restartedAt 이 없다. 복구시간은 0 이고 통계의 평균에도 들어가지 않는다.
  const openEpisode = await prisma.stoppageEpisode.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: cv01.id,
      cause: "JAM", source: "AI",
      startedAt: minutesAgo(95),
      riskApproach: true, approachCount: 2, approachDwellSec: 24.7,
      note: "원료 걸림으로 벨트 정지. 작업자 2명이 위험구역에 진입했습니다.",
    },
  });

  // ── AI 가 잡은 위험 사건 (아직 사람이 판단하지 않음) ──
  const riskEvent = await prisma.riskEvent.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: cv01.id, zoneId: drivePulley.id, cameraId: camera.id,
      episodeId: openEpisode.id,
      source: "AI", code: "RESTART_WITH_WORKER_INSIDE", level: "CRITICAL",
      reason: "구동 풀리 하부에 작업자 1명이 있는 상태에서 컨베이어가 재가동 요청으로 전환됐습니다.",
      enteredAt: minutesAgo(14), detectedAt: minutesAgo(8),
      dwellSec: 6.4, occupantsAtPeak: 1, trackIds: JSON.stringify([3]),
      clipStartSec: 9.5, clipEndSec: 16.2, peakSec: 12,
      machineState: "RESTART_REQUESTED", severity: "HIGH", confidence: 0.86,
      zonePolygon: drivePulley.polygon, interlockEngaged: true,
      status: "PENDING", notifiedAt: minutesAgo(8), modelRepo: "yolo26n.pt",
    },
  });

  // 안전대 확인이 열려 있는 사건. AI 는 진입까지만 말하고 체결 여부는 비워 둔다.
  await prisma.riskEvent.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: cv01.id, zoneId: deck.id, cameraId: camera.id,
      episodeId: openEpisode.id,
      source: "AI", code: "PROLONGED_DWELL", level: "WARNING",
      reason: "벨트 상부 점검대에 작업자 1명이 18.3초 머물렀습니다.",
      enteredAt: minutesAgo(41), detectedAt: minutesAgo(40),
      dwellSec: 18.3, occupantsAtPeak: 1, trackIds: JSON.stringify([7]),
      clipStartSec: 3.2, clipEndSec: 21.5, peakSec: 12.8,
      machineState: "STOPPED", severity: "HIGH", confidence: 0.81,
      zonePolygon: deck.polygon, interlockEngaged: false,
      harnessStatus: "PENDING",
      status: "PENDING", notifiedAt: minutesAgo(40), modelRepo: "yolo26n.pt",
    },
  });

  await prisma.restartRequest.create({
    data: {
      equipmentId: cv01.id, workplaceId: gwangyang.id, requestedById: operator.id,
      requestedAt: minutesAgo(7), reason: "이물 제거 완료로 판단, 원료 이송 재개 필요",
      decision: "BLOCKED", decidedAt: minutesAgo(7),
      blockReason: "위험구역에 작업자가 남아 있고 개인 시건 2건이 해제되지 않았습니다.",
      blockedById: riskEvent.id, occupancyAtRequest: 1, outcome: "OPEN",
    },
  });

  await prisma.equipmentStateLog.createMany({
    data: [
      { equipmentId: cv01.id, fromState: "RUNNING", toState: "MAINTENANCE", cause: "MAINTENANCE", at: minutesAgo(95), actorId: manager.id },
      { equipmentId: cv01.id, fromState: "MAINTENANCE", toState: "MAINTENANCE", cause: "AI_INTERLOCK", note: "잔류 감지로 인터록 체결", at: minutesAgo(8) },
    ],
  });

  // ── 최근 30일 정지 이력 ───────────────────────────────
  //
  // 반복 패턴 화면의 근거다. 하루치 데이터로는 "반복"을 보여줄 수 없다.
  //
  // 실운영에서 이 표는 PLC 정지 신호로 채워지고(source: PLC), 위험접근 표시만 영상 분석이
  // 채운다. 그래서 여기 시드도 source 를 PLC 로 둔다 — 데모를 위해 AI 가 한 달을 분석한
  // 것처럼 꾸미지 않는다.
  const history = await seedStoppageHistory(gwangyang.id, [
    // 걸림이 한 설비에 쏠린 상황을 만든다. 이게 이 화면이 찾아내야 하는 것이다.
    { equipmentId: cv01.id, jams: 42, approaches: 31, recoveryRange: [240, 780], hours: [9, 10, 14, 15, 22] },
    { equipmentId: cv02.id, jams: 11, approaches: 4, recoveryRange: [180, 420], hours: [8, 13, 20] },
    // 복구가 유독 오래 걸리는 설비. 오래 걸릴수록 위험구역에 머무는 시간도 길어진다.
    { equipmentId: cv07.id, jams: 8, approaches: 2, recoveryRange: [700, 1_100], hours: [11, 16, 23] },
    // 계획 정비는 걸림이 아니다. 손실 금액에도 들어가지 않는다.
    { equipmentId: rm02.id, jams: 0, approaches: 0, recoveryRange: [3_600, 7_200], hours: [6], maintenance: 3 },
  ]);

  console.log("시드 완료");
  console.log(`  작업일 ${TODAY} (Asia/Seoul)`);
  console.log(`  사업장 ${gwangyang.name} / ${pohang.name}`);
  console.log(`  설비 CV-01 정비중(인터록 BLOCKED) · CV-02 / CV-07 / RM-02 가동`);
  console.log(`  위험구역 ${drivePulley.name} 외 2개(상부 점검대는 안전대 확인 대상)`);
  console.log(`  정비작업 "${work.title}"`);
  console.log(`  카메라 ${camera.name}(컨베이어) · ${deckCamera.name}(안전대 전용 화각)`);
  console.log(
    `  수신함 스냅샷 ${snapshotRows.length}장` +
      (seedDetected > 0
        ? ` · ${seedDetected}장에 사람 박스 붙음`
        : " · AI 서비스에 닿지 못해 박스는 비어 있습니다"),
  );
  console.log(`  최근 30일 정지 이력 ${history.total}건 (걸림 ${history.jams} · 위험접근 ${history.approaches})`);
  console.log("");
  console.log("  로그인 (비밀번호 전부 test1234)");
  console.log("    M0001 김안전 · 안전관리자");
  console.log("    O2001 한운전 · 설비 운전 담당자");
  console.log("    W1001 박정비 / W1002 이현장 / W1003 최이송 · 작업자");
  console.log(`  안전관리자 가입 인증번호  광양 ${gwangyang.managerCode} · 포항 ${pohang.managerCode}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
