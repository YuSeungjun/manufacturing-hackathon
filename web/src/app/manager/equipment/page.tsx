import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHead, SectionHead, Empty, InterlockBadge, RunStateTag, Metric } from "@/components/ui";
import { ZONE_KIND_LABEL, parsePolygon } from "@/lib/zone";
import { formatDurationKo } from "@/lib/date";
import { EquipmentForm } from "./EquipmentForm";
import { SettingsForm } from "./SettingsForm";

export default async function EquipmentPage() {
  const manager = await requireManager();
  const equipment = await prisma.equipment.findMany({
    where: { workplaceId: manager.workplaceId },
    orderBy: [{ line: "asc" }, { code: "asc" }],
    include: {
      zones: { where: { active: true }, orderBy: { order: "asc" } },
      cameras: true,
    },
  });

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        stage={1}
        title="위험구역 설정"
        sub="설비마다 끼임이 일어날 수 있는 구역을 카메라 화면 위에 그려 둡니다. 여기서 그린 구역이 AI 판정의 기준이 됩니다."
      />

      <section className="flex flex-col gap-3">
        <SectionHead title="설비" count={`${equipment.length}대`} />
        {equipment.length === 0 ? (
          <Empty>아직 등록된 설비가 없습니다. 아래에서 첫 설비를 등록해 주세요.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {equipment.map((item) => {
              const drawn = item.zones.filter((z) => parsePolygon(z.polygon).length >= 3);
              const poster = item.cameras.find((c) => c.posterPath)?.posterPath;
              return (
                <li key={item.id} className="paper p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="num text-[12.5px] font-bold text-ink-3">{item.code}</span>
                    <h3 className="text-[15px] font-bold">{item.name}</h3>
                    {item.line ? <span className="text-[12.5px] text-ink-3">{item.line}</span> : null}
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      <RunStateTag state={item.runState} />
                      <InterlockBadge interlock={item.interlock} reason={item.interlockReason} />
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Metric label="위험구역" value={`${drawn.length}`} />
                    <Metric label="카메라" value={`${item.cameras.length}`} />
                    {drawn.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {drawn.map((zone) => (
                          <span key={zone.id} className="tag">
                            {zone.name}
                            <span className="text-ink-3">
                              {ZONE_KIND_LABEL[zone.kind] ?? zone.kind} ·{" "}
                              {formatDurationKo(zone.dwellThresholdSec)}
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <Link
                      href={`/manager/equipment/${item.id}/zones`}
                      className={`ml-auto btn-sm ${drawn.length === 0 ? "btn-act" : "btn-quiet"}`}
                    >
                      {drawn.length === 0 ? "위험구역 그리기" : "구역 편집"}
                    </Link>
                  </div>

                  {!poster && drawn.length === 0 ? (
                    <p className="mt-2.5 text-[12.5px] text-ink-3">
                      구역을 그리려면 카메라 정지 프레임이 한 장 필요합니다. 편집 화면에서 올릴 수 있습니다.
                    </p>
                  ) : null}

                  <div className="mt-3 border-t border-rule pt-3">
                    <SettingsForm
                      equipmentId={item.id}
                      kind={item.kind}
                      downtimeCostPerMin={item.downtimeCostPerMin}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="설비 등록" />
        <EquipmentForm />
      </section>
    </div>
  );
}
