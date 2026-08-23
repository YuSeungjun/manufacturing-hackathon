import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  }),
});

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  await prisma.review.deleteMany();
  await prisma.detection.deleteMany();
  await prisma.tbmAcknowledgement.deleteMany();
  await prisma.tbmAssignee.deleteMany();
  await prisma.safetyRule.deleteMany();
  await prisma.tbm.deleteMany();
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
      { name: "제강 1조", workArea: "제강공장 전로 A", workplaceId: gwangyang.id },
      { name: "압연 2조", workArea: "열연공장 가열로", workplaceId: gwangyang.id },
      { name: "정비 3조", workArea: "고로 5기 주변", workplaceId: gwangyang.id },
      { name: "제강 1조", workArea: "제강공장 전로 B", workplaceId: pohang.id },
    ].map((data) => prisma.team.create({ data })),
  );

  const password = await bcrypt.hash("test1234", 10);

  const manager = await prisma.user.create({
    data: {
      employeeNumber: "M0001",
      name: "김안전",
      passwordHash: password,
      role: "SAFETY_MANAGER",
      approvalStatus: "APPROVED",
      workplaceId: gwangyang.id,
      teamId: teams[0].id,
    },
  });

  const workers = await Promise.all(
    [
      { employeeNumber: "W1001", name: "박작업", teamId: teams[0].id },
      { employeeNumber: "W1002", name: "이현장", teamId: teams[0].id },
      { employeeNumber: "W1003", name: "최압연", teamId: teams[1].id },
      { employeeNumber: "W1004", name: "정정비", teamId: teams[2].id },
    ].map((w) =>
      prisma.user.create({
        data: {
          ...w,
          passwordHash: password,
          role: "WORKER",
          approvalStatus: "APPROVED",
          workplaceId: gwangyang.id,
        },
      }),
    ),
  );

  const tbm = await prisma.tbm.create({
    data: {
      workDate: today(),
      workType: "전로 출강구 보수 작업",
      workArea: "제강공장 전로 A",
      summary: "출강구 내화물 교체. 고온 용강 인접 구역으로 개인보호구 착용 필수.",
      createdById: manager.id,
      workplaceId: gwangyang.id,
      teamId: teams[0].id,
      // 서명 대상은 그날 투입되는 사람만 지정한다.
      assignees: { create: [{ userId: workers[0].id }, { userId: workers[1].id }] },
      rules: {
        create: [
          {
            hazard: "낙하물 및 상부 설비 충돌",
            description: "안전모 착용",
            detectionType: "CCTV",
            ppeCode: "NO_HARDHAT",
            severity: "HIGH",
            penalty: 20,
            order: 1,
          },
          {
            hazard: "중장비 및 대차 통행 중 미인지",
            description: "안전조끼 착용",
            detectionType: "CCTV",
            ppeCode: "NO_SAFETY_VEST",
            severity: "MEDIUM",
            penalty: 10,
            order: 2,
          },
          {
            hazard: "내화물 해체 시 분진 흡입",
            description: "방진마스크 착용",
            detectionType: "CCTV",
            ppeCode: "NO_MASK",
            severity: "MEDIUM",
            penalty: 10,
            order: 3,
          },
          {
            hazard: "고온 용강 비산",
            description: "방열복 및 보안면 착용 후 출강구 3m 이내 접근",
            detectionType: "MANUAL",
            severity: "HIGH",
            penalty: 20,
            order: 4,
          },
          {
            hazard: "정비 중 설비 오작동",
            description: "작업 전 전원 차단 및 LOTO 시건 확인",
            detectionType: "MANUAL",
            severity: "HIGH",
            penalty: 20,
            order: 5,
          },
        ],
      },
    },
  });

  await prisma.tbmAcknowledgement.create({
    data: { tbmId: tbm.id, userId: workers[0].id },
  });

  await prisma.tbm.create({
    data: {
      workDate: today(),
      workType: "가열로 버너 점검",
      workArea: "열연공장 가열로",
      summary: "버너 노즐 카본 제거 및 화염 상태 점검.",
      createdById: manager.id,
      workplaceId: gwangyang.id,
      teamId: teams[1].id,
      assignees: { create: [{ userId: workers[2].id }] },
      rules: {
        create: [
          {
            hazard: "고온 설비 접촉 화상",
            description: "안전모 착용",
            detectionType: "CCTV",
            ppeCode: "NO_HARDHAT",
            severity: "HIGH",
            penalty: 20,
            order: 1,
          },
          {
            hazard: "가스 누출",
            description: "휴대용 가스검지기 상시 휴대",
            detectionType: "SENSOR",
            severity: "HIGH",
            penalty: 20,
            order: 2,
          },
        ],
      },
    },
  });

  console.log("seed 완료");
  console.log("  안전관리자: M0001 / test1234");
  console.log("  작 업 자  : W1001 / test1234");
  console.log(`  관리자 인증번호: ${gwangyang.name} = ${gwangyang.managerCode}`);
  console.log(`                  ${pohang.name} = ${pohang.managerCode}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
