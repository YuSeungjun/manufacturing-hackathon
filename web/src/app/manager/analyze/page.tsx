import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiHealth } from "@/lib/aiClient";
import { PageHead, SectionHead, Empty, LevelTag } from "@/components/ui";
import { formatStamp, formatDurationKo } from "@/lib/date";
import { parsePolygon, type TrackBox, type ZonePoint } from "@/lib/zone";
import { SnapshotInbox, type SnapshotItem } from "./SnapshotInbox";

/** 수신함에 한 번에 띄우는 장면 수. 더 많으면 고르기가 아니라 스크롤이 된다. */
const INBOX_LIMIT = 48;

export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: string }>;
}) {
  const manager = await requireManager();
  /**
   * 탭은 입력 방식이 아니라 **구역 종류** 로 갈린다.
   *
   * 끼임(컨베이어)과 추락(고소 점검통로)은 다른 질문이고 화각도 다르다. 한 수신함에
   * 섞어 두면 컨베이어 폴리곤이 그려진 장면과 안전대 장면을 같이 골라 분석하는 실수가
   * 쉬워진다 — 카메라가 섞이면 좌표계가 달라 판정이 무의미하다.
   */
  const tab = (await searchParams).zone === "fall" ? "FALL" : "PINCH";

  const [equipment, zones, health, snapshots, recent] = await Promise.all([
    prisma.equipment.findMany({
      where: { workplaceId: manager.workplaceId },
      orderBy: [{ line: "asc" }, { code: "asc" }],
      include: { _count: { select: { zones: { where: { active: true } } } } },
    }),
    prisma.dangerZone.findMany({
      where: { active: true, equipment: { workplaceId: manager.workplaceId } },
      orderBy: { order: "asc" },
      select: { id: true, name: true, polygon: true, cameraId: true, equipmentId: true },
    }),
    aiHealth(),
    prisma.cameraSnapshot.findMany({
      where: { workplaceId: manager.workplaceId, camera: { purpose: tab } },
      orderBy: { capturedAt: "desc" },
      take: INBOX_LIMIT,
      include: {
        camera: { select: { code: true, name: true } },
        equipment: { select: { code: true, name: true } },
      },
    }),
    prisma.videoAnalysis.findMany({
      // 지금 보고 있는 구역의 분석만. 탭을 갈라 놓고 목록만 섞이면 헷갈린다.
      where: { workplaceId: manager.workplaceId, camera: { purpose: tab } },
      orderBy: { analyzedAt: "desc" },
      take: 8,
      include: {
        equipment: { select: { code: true, name: true } },
        riskEvents: { select: { level: true } },
      },
    }),
  ]);

  // 위험구역이 하나라도 그려져 있어야 분석이 성립한다.
  const ready = equipment.some((item) => item._count.zones > 0);

  /**
   * 스냅샷에 겹칠 위험구역.
   *
   * 폴리곤은 카메라 화각에 종속된다. 그래서 그 화각(cameraId)에 그린 구역을 1순위로 쓰고,
   * 카메라가 지정되지 않은 구역만 설비 기준으로 보조 매칭한다 — 다른 화각의 폴리곤을
   * 얹으면 엉뚱한 자리에 사각형이 뜬다.
   */
  function zonesFor(cameraId: string, equipmentId: string | null) {
    const byCamera = zones.filter((zone) => zone.cameraId === cameraId);
    const pool =
      byCamera.length > 0
        ? byCamera
        : zones.filter((zone) => zone.cameraId === null && zone.equipmentId === equipmentId);
    return pool.map((zone) => ({
      id: zone.id,
      name: zone.name,
      polygon: parsePolygon(zone.polygon) as ZonePoint[],
    }));
  }

  function parseBoxes(raw: string): TrackBox[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TrackBox[]) : [];
    } catch {
      return [];
    }
  }

  function parseOccupancy(raw: string): Record<string, number> {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
    } catch {
      return {};
    }
  }

  // 화면에는 촬영 순서대로 깐다. 시퀀스를 고르는 화면에서 최신순은 읽기가 거꾸로다.
  const items: SnapshotItem[] = [...snapshots].reverse().map((snapshot) => ({
    id: snapshot.id,
    imagePath: snapshot.imagePath,
    // 시간대 고정 포맷은 서버에서 만든다. 클라이언트에서 다시 만들면 어긋난다.
    capturedLabel: formatStamp(snapshot.capturedAt),
    capturedAtMs: snapshot.capturedAt.getTime(),
    trigger: snapshot.trigger,
    note: snapshot.note,
    cameraId: snapshot.cameraId,
    cameraCode: snapshot.camera.code,
    cameraName: snapshot.camera.name,
    equipmentCode: snapshot.equipment?.code ?? null,
    equipmentName: snapshot.equipment?.name ?? null,
    analysisId: snapshot.lastAnalysisId,
    personCount: snapshot.personCount,
    boxes: parseBoxes(snapshot.boxes),
    zoneOccupancy: parseOccupancy(snapshot.zoneOccupancy),
    detected: snapshot.detectedAt != null,
    zones: zonesFor(snapshot.cameraId, snapshot.equipmentId),
    harnessVerdict: snapshot.harnessVerdict,
    harnessConfidence: snapshot.harnessConfidence,
    harnessProvider: snapshot.harnessProvider,
    hookVerdict: snapshot.hookVerdict,
    hookConfidence: snapshot.hookConfidence,
  }));

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        stage={2}
        title="장면 선택"
        sub={
          tab === "PINCH"
            ? "CCTV 가 컨베이어 위험구역 접근을 감지하면 그 순간을 찍어 남깁니다. 안전관리자는 그중 볼 장면을 골라 분석합니다."
            : "추락 위험 구역에 작업자가 들어오면 그 순간을 찍어 남깁니다. 안전대 착용과 훅 체결을 판정할 장면을 골라 주세요."
        }
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

      {/*
        모델 이름과 입력 크기는 화면에서 뺐다 — 보는 사람에게 뜻이 없는 내부 값이다.
        프라이버시 선언은 남긴다. 이건 내부 값이 아니라 이 시스템이 무엇을 하지 않는지에
        대한 약속이고, /health 응답의 identifiesIndividuals·faceBlur 와 같은 내용이다.
      */}
      {health ? (
        <p className="text-[12.5px] leading-5 text-ink-3">
          사람만 탐지하며 얼굴 인식과 개인 식별은 하지 않습니다. 저장되는 캡처의 머리 부분은
          흐리게 처리됩니다.
        </p>
      ) : (
        <p className="text-[13px] leading-6" style={{ color: "var(--hold)" }}>
          AI 서비스에 연결하지 못했습니다. 분석은 할 수 없지만 이미 기록된 사건 검토와 재가동
          차단은 그대로 동작합니다.
        </p>
      )}

      {!ready ? (
        <Empty>
          아직 위험구역이 없습니다.{" "}
          <Link href="/manager/equipment" className="font-bold text-act underline">
            먼저 위험구역을 그려 주세요.
          </Link>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/manager/analyze"
              className={`btn-sm ${tab === "PINCH" ? "btn-act" : "btn-quiet"}`}
            >
              컨베이어 구역
            </Link>
            <Link
              href="/manager/analyze?zone=fall"
              className={`btn-sm ${tab === "FALL" ? "btn-act" : "btn-quiet"}`}
            >
              추락 위험 구역
            </Link>
            <span className="text-[12px] leading-5 text-ink-3">
              {tab === "PINCH"
                ? "끼임을 봅니다 — 진입·잔류에 설비 상태를 겹칩니다. 설비 상태는 실운영에서 PLC 가 줍니다."
                : "추락을 봅니다 — 안전대 착용과 훅 체결을 따로 판정하고, 확정은 사건 검토에서 사람이 합니다."}
            </span>
          </div>

          <section className="flex flex-col gap-3">
            <SectionHead
              title={tab === "PINCH" ? "컨베이어 구역 수신함" : "추락 위험 구역 수신함"}
              count={`${items.length}장`}
              action={
                items.length >= INBOX_LIMIT ? (
                  <span className="text-[12px] text-ink-3">최근 {INBOX_LIMIT}장만 표시</span>
                ) : undefined
              }
            />
            {items.length === 0 ? (
              <Empty>
                이 구역에 수신된 장면이 없습니다. 카메라가{" "}
                <code className="num">POST /api/snapshots</code> 로 밀어 넣으면 여기에 쌓입니다.
              </Empty>
            ) : (
              <SnapshotInbox snapshots={items} purpose={tab} />
            )}
          </section>
        </>
      )}

      <section className="flex flex-col gap-3">
        <SectionHead title="최근 분석" count={`${recent.length}건`} />
        {recent.length === 0 ? (
          <Empty>아직 분석한 기록이 없습니다.</Empty>
        ) : (
          <ul className="ruled paper">
            {recent.map((analysis) => {
              const critical = analysis.riskEvents.filter((e) => e.level === "CRITICAL").length;
              return (
                <li
                  key={analysis.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <span className="num text-[12.5px] text-ink-3">{analysis.equipment.code}</span>
                  <span className="text-[13.5px] font-bold">{analysis.equipment.name}</span>
                  <span className="num text-[12.5px] text-ink-3">
                    {formatStamp(analysis.analyzedAt)}
                  </span>
                  <span className="tag">
                    {analysis.sourceKind === "FRAMES"
                      ? `장면 ${analysis.frameCount}장`
                      : "영상 (과거 기록)"}
                  </span>
                  {analysis.status === "DONE" ? (
                    <span className="num text-[12.5px] text-ink-3">
                      구간 {formatDurationKo(analysis.durationSec)} · 처리{" "}
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
                  <Link
                    href={`/manager/analysis/${analysis.id}`}
                    className="ml-auto btn-quiet btn-sm"
                  >
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
