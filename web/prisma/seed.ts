import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { isoDateToInstant, todayLocalISO } from "../src/lib/date";

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

async function main() {
  // FK 역순으로 지운다
  await prisma.review.deleteMany();
  await prisma.restartRequest.deleteMany();
  await prisma.riskEvent.deleteMany();
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
      { name: "열연 정비 1조", workArea: "열연공장 조압연", workplaceId: gwangyang.id },
      { name: "압연 정비 2조", workArea: "열연공장 사상압연", workplaceId: gwangyang.id },
      { name: "냉연 정비 3조", workArea: "냉연공장 산세라인", workplaceId: gwangyang.id },
      { name: "열연 정비 1조", workArea: "열연공장 조압연", workplaceId: pohang.id },
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
      { employeeNumber: "W1003", name: "최압연", teamId: team2.id },
    ].map((u) =>
      prisma.user.create({
        data: { ...u, passwordHash: password, role: "WORKER", workplaceId: gwangyang.id },
      }),
    ),
  );

  // ── 설비 ─────────────────────────────────────────────
  const rm01 = await prisma.equipment.create({
    data: {
      code: "RM-01", name: "조압연기 1호", line: "열연 1라인",
      workplaceId: gwangyang.id, runState: "STOPPED", interlock: "CLEAR",
    },
  });
  const rm02 = await prisma.equipment.create({
    data: {
      code: "RM-02", name: "조압연기 2호", line: "열연 1라인",
      workplaceId: gwangyang.id, runState: "MAINTENANCE", interlock: "BLOCKED",
      interlockReason: "정비 작업 진행 중 — 개인 시건 2건 미해제",
      interlockedAt: minutesAgo(95),
    },
  });
  await prisma.equipment.create({
    data: {
      code: "FM-03", name: "사상압연기 3호", line: "열연 1라인",
      workplaceId: gwangyang.id, runState: "RUNNING", interlock: "CLEAR",
    },
  });

  const camera = await prisma.cameraFeed.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: rm02.id,
      code: "CAM-RM02-N", name: "조압연 2호 북측",
      posterPath: "/evidence/seed-rm02-north.jpg",
    },
  });
  await prisma.cameraFeed.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: rm01.id,
      code: "CAM-RM01-N", name: "조압연 1호 북측",
    },
  });

  const rollGap = await prisma.dangerZone.create({
    data: {
      equipmentId: rm02.id, cameraId: camera.id, name: "롤 갭 하부",
      polygon: JSON.stringify([[0.28, 0.42], [0.68, 0.4], [0.72, 0.86], [0.24, 0.88]]),
      dwellThresholdSec: 5, kind: "PINCH", severity: "HIGH", order: 0,
    },
  });
  await prisma.dangerZone.create({
    data: {
      equipmentId: rm02.id, cameraId: camera.id, name: "구동측 커플링",
      polygon: JSON.stringify([[0.72, 0.35], [0.94, 0.34], [0.95, 0.7], [0.73, 0.72]]),
      dwellThresholdSec: 5, kind: "ROTATING", severity: "HIGH", order: 1,
    },
  });

  // ── 정비 작업과 개인 시건 ─────────────────────────────
  const work = await prisma.maintenanceWork.create({
    data: {
      workDate: WORK_DATE, title: "조압연 2호 백업롤 교체",
      summary: "상부 백업롤 교체 및 롤 갭 청소. 작업 중 설비 재가동 금지.",
      status: "IN_PROGRESS", startedAt: minutesAgo(95),
      equipmentId: rm02.id, workplaceId: gwangyang.id, teamId: team1.id,
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

  // ── AI 가 잡은 위험 사건 (아직 사람이 판단하지 않음) ──
  const riskEvent = await prisma.riskEvent.create({
    data: {
      workplaceId: gwangyang.id, equipmentId: rm02.id, zoneId: rollGap.id, cameraId: camera.id,
      source: "AI", code: "RESTART_WITH_WORKER_INSIDE", level: "CRITICAL",
      reason: "롤 갭 하부 안에 작업자 1명이 있는 상태에서 설비가 재가동 요청으로 전환됐습니다.",
      enteredAt: minutesAgo(14), detectedAt: minutesAgo(8),
      dwellSec: 6.4, occupantsAtPeak: 1, trackIds: JSON.stringify([3]),
      clipStartSec: 9.5, clipEndSec: 16.2, peakSec: 12,
      machineState: "RESTART_REQUESTED", severity: "HIGH", confidence: 0.86,
      zonePolygon: rollGap.polygon, interlockEngaged: true,
      status: "PENDING", notifiedAt: minutesAgo(8), modelRepo: "yolo26n.pt",
    },
  });

  await prisma.restartRequest.create({
    data: {
      equipmentId: rm02.id, workplaceId: gwangyang.id, requestedById: operator.id,
      requestedAt: minutesAgo(7), reason: "롤 교체 완료로 판단, 라인 재개 필요",
      decision: "BLOCKED", decidedAt: minutesAgo(7),
      blockReason: "위험구역에 작업자가 남아 있고 개인 시건 2건이 해제되지 않았습니다.",
      blockedById: riskEvent.id, occupancyAtRequest: 1, outcome: "OPEN",
    },
  });

  await prisma.equipmentStateLog.createMany({
    data: [
      { equipmentId: rm02.id, fromState: "RUNNING", toState: "MAINTENANCE", cause: "MAINTENANCE", at: minutesAgo(95), actorId: manager.id },
      { equipmentId: rm02.id, fromState: "MAINTENANCE", toState: "MAINTENANCE", cause: "AI_INTERLOCK", note: "잔류 감지로 인터록 체결", at: minutesAgo(8) },
    ],
  });

  console.log("시드 완료");
  console.log(`  작업일 ${TODAY} (Asia/Seoul)`);
  console.log(`  사업장 ${gwangyang.name} / ${pohang.name}`);
  console.log(`  설비 RM-01 정지 · RM-02 정비중(인터록 BLOCKED) · FM-03 가동`);
  console.log(`  위험구역 ${rollGap.name} 외 1개, 정비작업 "${work.title}"`);
  console.log("");
  console.log("  로그인 (비밀번호 전부 test1234)");
  console.log("    M0001 김안전 · 안전관리자");
  console.log("    O2001 한운전 · 설비 운전 담당자");
  console.log("    W1001 박정비 / W1002 이현장 / W1003 최압연 · 작업자");
  console.log(`  안전관리자 가입 인증번호  광양 ${gwangyang.managerCode} · 포항 ${pohang.managerCode}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
