import Link from "next/link";
import { notFound } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHead, SectionHead, Empty } from "@/components/ui";
import { ZONE_KIND_LABEL, parsePolygon } from "@/lib/zone";
import { formatDurationKo } from "@/lib/date";
import { deleteDangerZoneAction } from "@/app/actions/equipment";
import { ZoneEditor } from "./ZoneEditor";
import { PosterForm } from "./PosterForm";

export default async function ZonesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ zone?: string }>;
}) {
  const manager = await requireManager();
  const { id } = await params;
  const { zone: editingId } = await searchParams;

  const equipment = await prisma.equipment.findFirst({
    where: { id, workplaceId: manager.workplaceId },
    include: {
      zones: { where: { active: true }, orderBy: { order: "asc" } },
      cameras: { orderBy: { code: "asc" } },
    },
  });
  if (!equipment) notFound();

  const camera = equipment.cameras.find((c) => c.posterPath) ?? equipment.cameras[0] ?? null;
  const zones = equipment.zones.map((z) => ({
    id: z.id,
    name: z.name,
    polygon: parsePolygon(z.polygon),
    dwellThresholdSec: z.dwellThresholdSec,
    kind: z.kind,
    severity: z.severity,
  }));
  const editing = editingId ? (zones.find((z) => z.id === editingId) ?? null) : null;

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        stage={1}
        eyebrow={
          <>
            <span className="num text-[12.5px] font-bold text-ink-3">{equipment.code}</span>
            <span className="text-[12.5px] text-ink-3">{equipment.line}</span>
          </>
        }
        title={`${equipment.name} 위험구역`}
        sub="카메라 화면 위에 끼임 구역을 그립니다. 여기 그린 모양이 그대로 AI 판정의 기준이 되고, 사건 근거 이미지에도 같은 자리에 겹쳐 보입니다."
        action={
          <Link href="/manager/equipment" className="btn-quiet btn-sm">
            설비 목록
          </Link>
        }
      />

      {camera?.posterPath ? (
        <section className="flex flex-col gap-3">
          <SectionHead
            title={editing ? `"${editing.name}" 편집` : "새 위험구역 그리기"}
            action={
              editing ? (
                <Link href={`/manager/equipment/${equipment.id}/zones`} className="btn-quiet btn-sm">
                  새로 그리기
                </Link>
              ) : null
            }
          />
          <ZoneEditor
            equipmentId={equipment.id}
            cameraId={camera.id}
            poster={camera.posterPath}
            zones={zones}
            editing={editing}
          />
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <SectionHead title="카메라 화면 등록" />
          <p className="text-[13.5px] leading-6 text-ink-2">
            구역을 그리려면 이 설비를 비추는 CCTV 의 정지 프레임이 한 장 필요합니다. 분석할 영상과
            같은 카메라·같은 화각이어야 좌표가 맞습니다.
          </p>
          <PosterForm equipmentId={equipment.id} cameraId={camera?.id ?? null} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionHead title="등록된 위험구역" count={`${zones.length}개`} />
        {zones.length === 0 ? (
          <Empty>아직 그린 구역이 없습니다. 위에서 첫 구역을 그려 주세요.</Empty>
        ) : (
          <ul className="ruled paper">
            {equipment.zones.map((zone) => (
              <li key={zone.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="text-[14px] font-bold">{zone.name}</span>
                <span className="tag">{ZONE_KIND_LABEL[zone.kind] ?? zone.kind}</span>
                <span className="num text-[12.5px] text-ink-3">
                  잔류 {formatDurationKo(zone.dwellThresholdSec)} · 꼭짓점{" "}
                  {parsePolygon(zone.polygon).length}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <Link
                    href={`/manager/equipment/${equipment.id}/zones?zone=${zone.id}`}
                    className="btn-quiet btn-sm"
                  >
                    편집
                  </Link>
                  <form action={deleteDangerZoneAction}>
                    <input type="hidden" name="zoneId" value={zone.id} />
                    <button type="submit" className="btn-quiet btn-sm">
                      해제
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
        {zones.length > 0 && camera?.posterPath ? (
          <details className="text-[12.5px] text-ink-3">
            <summary className="cursor-pointer">카메라 화면 바꾸기</summary>
            <div className="mt-2">
              <PosterForm equipmentId={equipment.id} cameraId={camera.id} />
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}
