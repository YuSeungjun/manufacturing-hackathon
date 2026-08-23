/**
 * 같은 순간이 여러 건으로 등록된 위험 사건을 하나로 합친다.
 *
 * 왜 생겼나 — 예전에는 같은 장면을 다시 분석하면 매번 새 사건이 만들어졌다. 테스트로
 * 다섯 번 돌리면 검토 대기가 같은 사건의 복사본 다섯 개로 채워진다. 지금은
 * `persistAnalysisResultAction` 이 자연키로 중복을 막지만, 그 전에 쌓인 것은 남아 있다.
 *
 * 자연키는 (사업장, 설비, 구역, 코드, 진입시각) 이다.
 *
 * 무엇을 남기나
 *   1. 사람이 판단한 건(status != PENDING) — 판단은 데이터보다 귀하다
 *   2. 없으면 가장 먼저 만들어진 건
 *
 * 무엇을 지우지 않나
 *   - 재가동 요청이 참조하는 건(`RestartRequest.blockedById`). 차단 근거가 사라지면
 *     "왜 막혔는지" 를 설명할 수 없다.
 *
 *   npm run fix:dedupe            (무엇을 지울지만 보여준다)
 *   npm run fix:dedupe -- --apply (실제로 지운다)
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

  const events = await prisma.riskEvent.findMany({
    orderBy: { detectedAt: "asc" },
    include: {
      equipment: { select: { code: true } },
      zone: { select: { name: true } },
      blocked: { select: { id: true } },
    },
  });

  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const key = [
      event.workplaceId,
      event.equipmentId,
      event.zoneId ?? "-",
      event.code,
      event.enteredAt.toISOString(),
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  const doomed: typeof events = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // 사람이 판단한 건이 있으면 그것을 남긴다. 없으면 가장 오래된 것.
    const judged = list.find((e) => e.status !== "PENDING");
    const keep = judged ?? list[0];
    for (const event of list) {
      if (event.id === keep.id) continue;
      if (event.blocked.length > 0) continue; // 차단 근거는 남긴다
      doomed.push(event);
    }
    const e = list[0];
    console.log(
      `  ${e.equipment.code} ${e.zone?.name ?? "구역 미지정"} ${e.code} ` +
        `진입 ${e.enteredAt.toISOString().slice(5, 19)} — ${list.length}건 중 ` +
        `${keep.status} 하나만 남깁니다`,
    );
  }

  if (doomed.length === 0) {
    console.log("중복이 없습니다.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\n지울 사건 ${doomed.length}건 (${doomed.map((e) => e.status).join(", ")})`);
  if (!apply) {
    console.log("실제로 지우려면 --apply 를 붙여 주세요.");
    await prisma.$disconnect();
    return;
  }

  const { count } = await prisma.riskEvent.deleteMany({ where: { id: { in: doomed.map((e) => e.id) } } });
  const pending = await prisma.riskEvent.count({ where: { status: "PENDING" } });
  console.log(`${count}건 삭제. 남은 검토 대기 ${pending}건.`);
  await prisma.$disconnect();
}

run();
