import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Empty, PageHead } from "@/components/ui";
import { dayRange, todayLocalISO } from "@/lib/date";
import { aiHealth } from "@/lib/aiClient";
import { AnalyzeForm } from "./AnalyzeForm";

export default async function AnalyzePage() {
  const manager = await requireManager();
  const { from, to } = dayRange(todayLocalISO());

  const [tbms, health] = await Promise.all([
    prisma.tbm.findMany({
      where: { workplaceId: manager.workplaceId, workDate: { gte: from, lt: to } },
      include: { team: true, rules: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    aiHealth(),
  ]);

  return (
    <>
      <PageHead
        stage={3}
        eyebrow={
          <span className={`tag ${health ? "tag-safe" : "tag-deny"}`}>
            <span className="dot" aria-hidden />
            {health ? "AI 탐지 사용 가능" : "AI 탐지 중단"}
          </span>
        }
        title="영상 분석"
        sub="CCTV 캡처 이미지를 올리면 보호구 착용 여부를 확인합니다. TBM 안전수칙과 일치하는 위반 의심 항목만 검토 대기로 올라갑니다."
      />

      {health ? null : (
        <div className="mt-4 rounded-lg border-2 px-4 py-3.5 text-[14px] leading-6" style={{ borderColor: "var(--deny)", background: "var(--deny-soft)" }}>
          <p>
            지금은 영상을 분석할 수 없습니다. 이미 등록된 검토 대기 건은 그대로 있으니 탐지 검토는
            계속 진행할 수 있습니다.
          </p>
          {process.env.NODE_ENV === "development" ? (
            <p className="mt-2 text-[12.5px] text-ink-3">
              개발 환경 ·{" "}
              <code className="num rounded bg-paper-2 px-1.5 py-0.5">./ai/run.sh</code> 실행 후 새로고침
            </p>
          ) : null}
        </div>
      )}

      {tbms.length === 0 ? (
        <div className="mt-5">
          <Empty>
            오늘 작업일의 TBM이 없습니다. 분석 결과를 안전수칙에 연결하려면{" "}
            <Link href="/manager/tbm/new" className="font-bold underline" style={{ color: "var(--act)" }}>
              TBM을 먼저 작성해 주세요
            </Link>
            .
          </Empty>
        </div>
      ) : (
        <AnalyzeForm
          tbms={tbms.map((tbm) => ({
            id: tbm.id,
            label: `${tbm.team.name} · ${tbm.workType}`,
            workArea: tbm.workArea,
            aiRules: tbm.rules.filter((r) => r.ppeCode).map((r) => r.description),
          }))}
        />
      )}
    </>
  );
}
