/**
 * 위험 사건을 전부 비운다 — 검토 대기 / 진행 중 / 종결한 것까지.
 *
 * 흐름을 처음부터 시연할 때 쓴다: 빈 상태에서 영상 분석 한 번 →  사건 하나 →  위험 확정 →
 * 진행 중 →  확정·패스. 이전 테스트가 남아 있으면 어느 사건이 방금 만든 건지 알 수 없다.
 *
 * 함께 지우는 것 — 사건에 딸린 것들이라 남겨 두면 가리키는 대상이 없는 행이 된다.
 *   - Review        사람의 판단 기록
 *   - RestartRequest 차단 근거가 사건이다. 사건이 없으면 "왜 막혔는지" 를 설명할 수 없다
 *   - Equipment.interlock  근거가 사라졌으므로 CLEAR 로 돌린다. 근거 없는 차단은 남기지 않는다
 *
 * 남기는 것 — 스냅샷·분석 기록·정지 에피소드·안전대 판정. 사건과 별개의 사실이다.
 *
 *   npm run fix:clear-events            (무엇을 지울지만 보여준다)
 *   npm run fix:clear-events -- --apply (실제로 지운다)
 *
 * 시드 기준선으로 되돌리려면 `npx prisma db seed` 를 쓴다.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const apply = process.argv.includes("--apply");

async function run() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
    }),
  });

  const [byStatus, reviews, restarts, blocked] = await Promise.all([
    prisma.riskEvent.groupBy({ by: ["status"], _count: true }),
    prisma.review.count(),
    prisma.restartRequest.count(),
    prisma.equipment.count({ where: { interlock: "BLOCKED" } }),
  ]);

  const total = byStatus.reduce((sum, row) => sum + row._count, 0);
  if (total === 0 && reviews === 0 && restarts === 0) {
    console.log("이미 비어 있습니다.");
    await prisma.$disconnect();
    return;
  }

  console.log("지울 것");
  for (const row of byStatus.sort((a, b) => b._count - a._count)) {
    console.log(`  위험 사건 ${row.status.padEnd(15)} ${row._count}건`);
  }
  console.log(`  사람의 판단(Review)            ${reviews}건`);
  console.log(`  재가동 요청(RestartRequest)    ${restarts}건`);
  console.log(`  인터록 해제 대상 설비           ${blocked}대`);
  console.log("\n남기는 것: 스냅샷 · 분석 기록 · 정지 에피소드 · 안전대 판정");

  if (!apply) {
    console.log("\n실제로 지우려면 --apply 를 붙여 주세요.");
    await prisma.$disconnect();
    return;
  }

  // FK 역순. RestartRequest 가 RiskEvent 를 참조하므로 먼저 지운다.
  await prisma.$transaction([
    prisma.restartRequest.deleteMany(),
    prisma.review.deleteMany(),
    prisma.riskEvent.deleteMany(),
    prisma.equipment.updateMany({
      where: { interlock: "BLOCKED" },
      data: { interlock: "CLEAR", interlockReason: "", clearedAt: new Date() },
    }),
  ]);

  const left = await prisma.riskEvent.count();
  console.log(`\n비웠습니다. 남은 위험 사건 ${left}건.`);
  await prisma.$disconnect();
}

run();
