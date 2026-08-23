import Link from "next/link";
import { notFound } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHead, SectionHead, Empty, LevelTag, StatusTag, Metric } from "@/components/ui";
import {
  MACHINE_STATE_LABEL,
  parsePolygon,
  parseTimeline,
  riskCodeLabel,
  type RiskLevel,
} from "@/lib/zone";
import { formatClock, formatDurationKo, formatStamp } from "@/lib/date";
import { TimelinePlayer } from "./TimelinePlayer";
import { ReviewForm } from "@/app/manager/events/ReviewForm";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const manager = await requireManager();
  const { id } = await params;

  const analysis = await prisma.videoAnalysis.findFirst({
    where: { id, workplaceId: manager.workplaceId },
    include: {
      equipment: true,
      camera: true,
      riskEvents: { orderBy: { clipStartSec: "asc" }, include: { zone: true, review: true } },
    },
  });
  if (!analysis) notFound();

  const zones = await prisma.dangerZone.findMany({
    where: { equipmentId: analysis.equipmentId },
  });
  const warnings = JSON.parse(analysis.warnings || "[]") as string[];
  const frames = parseTimeline(analysis.timeline);

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        stage={2}
        eyebrow={
          <>
            <span className="num text-[12.5px] font-bold text-ink-3">{analysis.equipment.code}</span>
            <span className="text-[12.5px] text-ink-3">{analysis.equipment.name}</span>
            {analysis.camera ? (
              <span className="num text-[12.5px] text-ink-3">{analysis.camera.code}</span>
            ) : null}
          </>
        }
        title="영상 분석 결과"
        sub={`${formatStamp(analysis.analyzedAt)} 분석 · 길이 ${formatDurationKo(analysis.durationSec)} · ${analysis.frameCount}프레임을 ${analysis.sampledFps}fps 로 봤습니다.`}
        action={
          <Link href="/manager/analyze" className="btn-quiet btn-sm">
            새 영상 분석
          </Link>
        }
      />

      {analysis.status === "ERROR" ? (
        <p className="text-[13.5px] font-bold" style={{ color: "var(--deny)" }} role="alert">
          분석에 실패했습니다: {analysis.error}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md border border-rule px-3 py-2.5">
          {warnings.map((warning) => (
            <li key={warning} className="text-[12.5px] leading-5" style={{ color: "var(--hold)" }}>
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <TimelinePlayer
          videoPath={analysis.videoPath}
          posterPath={analysis.posterPath || analysis.camera?.posterPath || ""}
          durationSec={analysis.durationSec}
          frames={frames}
          zones={zones.map((z) => ({ id: z.id, name: z.name, polygon: parsePolygon(z.polygon) }))}
          events={analysis.riskEvents.map((e) => ({
            id: e.id,
            code: e.code,
            level: e.level as RiskLevel,
            startSec: e.clipStartSec ?? 0,
            endSec: e.clipEndSec ?? 0,
            peakSec: e.peakSec ?? 0,
            dwellSec: e.dwellSec,
            zoneName: e.zone?.name ?? "구역 미지정",
            reason: e.reason,
          }))}
        />

        <section className="flex flex-col gap-3">
          <SectionHead title="위험 사건" count={`${analysis.riskEvents.length}건`} />
          {analysis.riskEvents.length === 0 ? (
            <Empty>
              이 영상에서는 위험 사건이 나오지 않았습니다. 작업자가 위험구역에 머물지 않았거나,
              머무는 동안 설비가 계속 정지 상태였습니다.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {analysis.riskEvents.map((event) => (
                <li key={event.id} className="paper flex flex-col gap-2.5 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <LevelTag level={event.level} />
                    <span className="text-[13.5px] font-bold">{riskCodeLabel(event.code)}</span>
                    <StatusTag status={event.status} />
                  </div>

                  <p className="text-[13px] leading-6 text-ink-2">{event.reason}</p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <Metric
                      label="구간"
                      value={`${formatClock(event.clipStartSec ?? 0)}–${formatClock(event.clipEndSec ?? 0)}`}
                    />
                    <Metric label="잔류" value={formatDurationKo(event.dwellSec)} />
                    <Metric label="인원" value={`${event.occupantsAtPeak}`} />
                    <Metric
                      label="설비"
                      value={MACHINE_STATE_LABEL[event.machineState] ?? event.machineState}
                    />
                  </div>

                  <ReviewForm
                    riskEventId={event.id}
                    status={event.status}
                    comment={event.review?.comment ?? ""}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
