import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiHealth } from "@/lib/aiClient";
import { PageHead, SectionHead, Empty, LevelTag } from "@/components/ui";
import { formatStamp, formatDurationKo } from "@/lib/date";
import { VideoAnalyzeForm } from "./VideoAnalyzeForm";

export default async function AnalyzePage() {
  const manager = await requireManager();
  const [equipment, health, recent] = await Promise.all([
    prisma.equipment.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: [{ line: "asc" }, { code: "asc" }],
      include: { _count: { select: { zones: { where: { active: true } } } } },
    }),
    aiHealth(),
    prisma.videoAnalysis.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: { analyzedAt: "desc" },
      take: 8,
      include: {
        equipment: { select: { code: true, name: true } },
        riskEvents: { select: { level: true } },
      },
    }),
  ]);

  const options = equipment.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    zoneCount: e._count.zones,
  }));
  const ready = options.some((o) => o.zoneCount > 0);

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        stage={2}
        title="영상 분석"
        sub="CCTV 영상을 올리면 작업자를 프레임마다 찾아 위험구역 잔류를 재고, 설비 상태와 겹치는 순간을 위험 사건으로 잘라 냅니다."
        action={
          health ? (
            <span className="tag tag-safe">
              <span className="dot" aria-hidden />
              AI 탐지 사용 가능
            </span>
          ) : (
            <span className="tag tag-hold">
              <span className="dot" aria-hidden />
              AI 탐지 중단
            </span>
          )
        }
      />

      {health ? (
        <p className="text-[12.5px] leading-5 text-ink-3">
          모델 <span className="num">{health.model}</span> · 입력{" "}
          <span className="num">{health.imgsz}px</span> · 샘플링{" "}
          <span className="num">{health.targetFps}fps</span> · 사람만 탐지하며 얼굴 인식과 개인
          식별은 하지 않습니다. 저장되는 캡처의 머리 부분은 흐리게 처리됩니다.
        </p>
      ) : (
        <p className="text-[13px] leading-6" style={{ color: "var(--hold)" }}>
          AI 서비스에 연결하지 못했습니다. 분석은 할 수 없지만 이미 기록된 사건 검토와 재가동
          차단은 그대로 동작합니다.
        </p>
      )}

      {ready ? (
        <VideoAnalyzeForm equipment={options} />
      ) : (
        <Empty>
          아직 위험구역이 없습니다.{" "}
          <Link href="/manager/equipment" className="font-bold text-act underline">
            먼저 위험구역을 그려 주세요.
          </Link>
        </Empty>
      )}

      <section className="flex flex-col gap-3">
        <SectionHead title="최근 분석" count={`${recent.length}건`} />
        {recent.length === 0 ? (
          <Empty>아직 분석한 영상이 없습니다.</Empty>
        ) : (
          <ul className="ruled paper">
            {recent.map((analysis) => {
              const critical = analysis.riskEvents.filter((e) => e.level === "CRITICAL").length;
              return (
                <li key={analysis.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <span className="num text-[12.5px] text-ink-3">{analysis.equipment.code}</span>
                  <span className="text-[13.5px] font-bold">{analysis.equipment.name}</span>
                  <span className="num text-[12.5px] text-ink-3">
                    {formatStamp(analysis.analyzedAt)}
                  </span>
                  {analysis.status === "DONE" ? (
                    <span className="num text-[12.5px] text-ink-3">
                      길이 {formatDurationKo(analysis.durationSec)} · 처리{" "}
                      {formatDurationKo(analysis.processingSec)}
                    </span>
                  ) : (
                    <span className="tag tag-hold">
                      {analysis.status === "ERROR" ? "분석 실패" : "분석 중"}
                    </span>
                  )}
                  {critical > 0 ? <LevelTag level="CRITICAL" /> : null}
                  <span className="num text-[12.5px] text-ink-2">
                    사건 {analysis.riskEvents.length}건
                  </span>
                  <Link href={`/manager/analysis/${analysis.id}`} className="ml-auto btn-quiet btn-sm">
                    타임라인 보기
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
