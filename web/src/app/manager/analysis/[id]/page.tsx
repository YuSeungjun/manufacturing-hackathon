import { notFound } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHead, SectionHead, Empty, LevelTag, StatusTag, Metric } from "@/components/ui";
import {
  MACHINE_STATE_LABEL,
  parseBoxes,
  parsePolygon,
  parseTimeline,
  riskCodeLabel,
  type RiskLevel,
} from "@/lib/zone";
import { formatClock, formatDurationKo, formatStamp } from "@/lib/date";
import { TimelinePlayer } from "./TimelinePlayer";
import { ReviewForm } from "@/components/ReviewForm";

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

  // 안전대·훅은 추락 구역의 판정이다. 컨베이어(끼임) 구역에서는 볼 이유가 없다.
  const harnessApplies = analysis.camera?.purpose === "FALL";

  /**
   * 이 분석에 쓴 스냅샷들의 안전대 판정.
   *
   * 판정은 시퀀스 분석과 별도 버튼에서 나온다(공급자가 다르다). 하지만 **결과는 같은
   * 화면에서 봐야 한다** — 관리자가 한 장면을 보면서 "구역에 들어왔다" 와 "안전대를
   * 안 입었다" 를 따로 찾아다니게 만들 이유가 없다.
   *
   * capturedAt 순서가 frameUrls 순서와 같다(analyzeSnapshotsAction 이 그 순서로 넘긴다).
   */
  const usedSnapshots = harnessApplies
    ? await prisma.cameraSnapshot.findMany({
        where: { lastAnalysisId: analysis.id },
        orderBy: { capturedAt: "asc" },
        select: {
          harnessVerdict: true,
          harnessConfidence: true,
          harnessProvider: true,
          harnessBoxes: true,
          hookVerdict: true,
        },
      })
    : [];

  type HarnessPersonBox = {
    x: number; y: number; w: number; h: number;
    harness: { status: string; confidence: number; hookStatus?: string; hookConfidence?: number };
  };
  const harnessByFrame = usedSnapshots.map((snapshot) => {
    let boxes: HarnessPersonBox[] = [];
    try {
      const parsed = JSON.parse(snapshot.harnessBoxes || "[]");
      if (Array.isArray(parsed)) boxes = parsed as HarnessPersonBox[];
    } catch {
      boxes = [];
    }
    return {
      verdict: snapshot.harnessVerdict,
      confidence: snapshot.harnessConfidence,
      provider: snapshot.harnessProvider,
      hookVerdict: snapshot.hookVerdict,
      boxes: boxes.map((box) => ({
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        status: box.harness?.status ?? "UNKNOWN",
        confidence: box.harness?.confidence ?? 0,
        hookStatus: box.harness?.hookStatus ?? "UNKNOWN",
        hookConfidence: box.harness?.hookConfidence ?? 0,
      })),
    };
  });
  const warnings = JSON.parse(analysis.warnings || "[]") as string[];
  const frames = parseTimeline(analysis.timeline);
  const frameUrls = JSON.parse(analysis.frameUrls || "[]") as string[];
  const isFrameSequence = analysis.sourceKind === "FRAMES";

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
        title={isFrameSequence ? "이미지 분석 결과" : "영상 분석 결과"}
        sub={
          isFrameSequence
            ? `${formatStamp(analysis.analyzedAt)} 분석 · 선택한 이미지 ${analysis.frameCount}장을 확인했습니다.`
            : `${formatStamp(analysis.analyzedAt)} 분석 · 길이 ${formatDurationKo(analysis.durationSec)} · ${analysis.frameCount}프레임을 ${analysis.sampledFps}fps 로 봤습니다.`
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
          sourceKind={analysis.sourceKind}
          frameUrls={Array.isArray(frameUrls) ? frameUrls : []}
          harnessApplies={harnessApplies}
          harnessByFrame={harnessByFrame}
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
              {analysis.riskEvents.map((event) => {
                // 구역 안 인원과 화면에 잡힌 인원은 다른 수다. 박스는 두 개인데 인원이 1 이면
                // 세다 만 것처럼 보인다 — 한쪽은 구역 밖에 서 있었을 뿐이다.
                const detected = parseBoxes(event.boxes).length;
                return (
                <li key={event.id} className="paper flex flex-col gap-2.5 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <LevelTag level={event.level} />
                    <span className="text-[13.5px] font-bold">{riskCodeLabel(event.code)}</span>
                    <StatusTag status={event.status} />
                  </div>

                  <p className="text-[13px] leading-6 text-ink-2">
                    {event.reason}
                    {detected > event.occupantsAtPeak ? (
                      <>
                        {" "}
                        <span className="text-ink-3">
                          같은 장면에서 작업자 {detected}명이 탐지됐고, 그중{" "}
                          {event.occupantsAtPeak}명이 구역 안에 있었습니다.
                        </span>
                      </>
                    ) : null}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <Metric
                      label="구간"
                      value={`${formatClock(event.clipStartSec ?? 0)}–${formatClock(event.clipEndSec ?? 0)}`}
                    />
                    <Metric label="잔류" value={formatDurationKo(event.dwellSec)} />
                    <Metric label="구역 인원" value={`${event.occupantsAtPeak}명`} />
                    {detected > event.occupantsAtPeak ? (
                      <Metric label="화면 탐지" value={`${detected}명`} />
                    ) : null}
                    <Metric
                      label="설비"
                      value={MACHINE_STATE_LABEL[event.machineState] ?? event.machineState}
                    />
                  </div>

                  <ReviewForm
                    riskEventId={event.id}
                    status={event.status}
                    comment={event.review?.comment ?? ""}
                    cleared={event.clearedAt != null}
                  />
                </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
