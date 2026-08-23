import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHead, SectionHead, Empty, InterlockBadge, RunStateTag, Metric } from "@/components/ui";
import { formatStamp } from "@/lib/date";
import { RestartPanel } from "./RestartPanel";

export default async function OperatorPage() {
  const operator = await requireOperator();

  const equipment = await prisma.equipment.findMany({
    where: { workplaceId: operator.workplaceId },
    orderBy: [{ line: "asc" }, { code: "asc" }],
    include: {
      cameras: { where: { posterPath: { not: "" } }, take: 1 },
      zones: { where: { active: true }, select: { id: true } },
      works: {
        where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
        include: { locks: { where: { releasedAt: null }, include: { user: true } } },
      },
    },
  });

  const blocked = equipment.filter((e) => e.interlock === "BLOCKED");

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        stage={1}
        title="설비 운전"
        sub="재가동 전에 시스템이 위험구역을 먼저 확인합니다. 작업자가 남아 있으면 재가동은 진행되지 않습니다."
      />

      {blocked.length > 0 ? (
        <p
          className="rounded-md px-3.5 py-3 text-[13.5px] font-bold leading-6"
          style={{ border: `2px solid var(--deny)`, background: "var(--deny-soft)", color: "var(--deny)" }}
          role="status"
        >
          설비 {blocked.length}대가 재가동 차단 상태입니다. 위험 사건과 개인 시건 상태를 확인해 주세요.
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHead title="설비" count={`${equipment.length}대`} />
        {equipment.length === 0 ? (
          <Empty>등록된 설비가 없습니다. 안전관리자에게 문의해 주세요.</Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {equipment.map((item) => {
              const poster = item.cameras[0]?.posterPath;
              const openLocks = item.works.flatMap((w) => w.locks);
              return (
                <li
                  key={item.id}
                  className="paper grid gap-4 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]"
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-[12.5px] font-bold text-ink-3">{item.code}</span>
                      <h3 className="text-[15px] font-bold">{item.name}</h3>
                      <RunStateTag state={item.runState} />
                      <InterlockBadge interlock={item.interlock} reason={item.interlockReason} />
                    </div>

                    {poster ? (
                      <figure className="plate overflow-hidden">
                        <figcaption className="flex items-baseline gap-2 px-2 py-1.5">
                          <span className="scan">Cam</span>
                          <span className="text-[12px]" style={{ color: "var(--plate-ink)" }}>
                            {item.cameras[0].code}
                          </span>
                          <span className="scan ml-auto">최근 프레임</span>
                        </figcaption>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={poster} alt={`${item.name} 카메라 화면`} className="block w-full" />
                      </figure>
                    ) : (
                      <Empty>이 설비에 등록된 카메라 화면이 없습니다.</Empty>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <Metric label="위험구역" value={`${item.zones.length}`} />
                      <Metric label="미해제 시건" value={`${openLocks.length}`} />
                      {item.interlockedAt ? (
                        <Metric label="차단 시각" value={formatStamp(item.interlockedAt)} />
                      ) : null}
                    </div>

                    {openLocks.length > 0 ? (
                      <p className="text-[12.5px] leading-5 text-ink-3">
                        시건 중:{" "}
                        {openLocks.map((l) => `${l.user.name}(${l.user.employeeNumber})`).join(", ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-3 lg:border-l lg:border-rule lg:pl-4">
                    <RestartPanel
                      equipmentId={item.id}
                      equipmentName={item.name}
                      interlock={item.interlock}
                      interlockReason={item.interlockReason}
                      runState={item.runState}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-[12.5px] text-ink-3">
        <Link href="/operator/requests" className="font-bold text-act underline">
          내 재가동 요청 이력
        </Link>
        에서 차단 사유와 승인 상태를 확인할 수 있습니다.
      </p>
    </div>
  );
}
