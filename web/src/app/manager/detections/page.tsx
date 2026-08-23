import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EvidenceView } from "@/components/EvidenceView";
import { reviewDetectionAction } from "@/app/actions/detection";
import { Empty, JudgmentStamp, PageHead, StatusTag } from "@/components/ui";
import { SEVERITY_LABEL, parseBoxes, ppeLabel } from "@/lib/ppe";

const TABS = [
  { key: "PENDING", label: "검토 대기" },
  { key: "CONFIRMED", label: "위반 확정" },
  { key: "FALSE_POSITIVE", label: "오탐" },
  { key: "HOLD", label: "판단 보류" },
  { key: "ALL", label: "전체" },
];

export default async function DetectionsPage({ searchParams }: PageProps<"/manager/detections">) {
  const manager = await requireManager();
  const params = await searchParams;
  const filter = typeof params.status === "string" ? params.status : "PENDING";

  const detections = await prisma.detection.findMany({
    where: {
      tbm: { workplaceId: manager.workplaceId },
      ...(filter === "ALL" ? {} : { status: filter }),
    },
    orderBy: { detectedAt: "desc" },
    take: 30,
    include: {
      safetyRule: true,
      review: { include: { reviewedBy: true } },
      tbm: { include: { team: true } },
    },
  });

  return (
    <>
      <PageHead
        stage={4}
        title="탐지 검토"
        sub="왼쪽은 AI가 본 것, 오른쪽은 사람이 정하는 것입니다. 확정된 건만 안전이행 점수에 반영됩니다."
      />

      <div className="scroll-x -mx-4 mt-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1.5">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={`/manager/detections?status=${tab.key}`}
              aria-current={filter === tab.key ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-md border px-3 text-[13px] font-bold transition-colors ${
                filter === tab.key
                  ? "border-transparent text-act-ink"
                  : "border-rule bg-paper text-ink-2 hover:bg-paper-2 hover:text-ink"
              }`}
              style={filter === tab.key ? { background: "var(--act)" } : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {detections.length === 0 ? (
        <div className="mt-5">
          <Empty>
            {filter === "PENDING"
              ? "검토를 기다리는 탐지가 없습니다. 현장 영상 분석에서 캡처 이미지를 올리면 여기에 쌓입니다."
              : "해당 상태의 탐지 기록이 없습니다."}
          </Empty>
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {detections.map((detection) => {
          const rule = detection.safetyRule;
          return (
            <article key={detection.id} className="paper-flush">
              <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                {/* ── 기계 층 ── */}
                <div className="bg-plate p-3">
                  <EvidenceView
                    src={detection.evidencePath}
                    boxes={parseBoxes(detection.boxes)}
                    highlightCode={detection.ppeCode}
                    camera={detection.location}
                    stamp={detection.detectedAt}
                  />
                  <dl className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <MachineValue label="CLASS" value={detection.ppeCode.replace(/_/g, "-")} />
                    <MachineValue label="CONF" value={detection.confidence.toFixed(2)} />
                    <MachineValue label="MODEL" value={detection.modelRepo ? "YOLOV8-PPE" : "—"} />
                  </dl>
                </div>

                {/* ── 사람 층 ── */}
                <div className="min-w-0 bg-paper p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[1.0625rem] font-extrabold tracking-[-0.01em]">
                      {ppeLabel(detection.ppeCode)} 의심
                    </h3>
                    {detection.status === "PENDING" ? (
                      <StatusTag status={detection.status} />
                    ) : (
                      <JudgmentStamp decision={detection.status} />
                    )}
                  </div>

                  <dl className="mt-3 border-y border-rule-soft py-1">
                    <Row label="작업조">{detection.tbm.team.name}</Row>
                    <Row label="작업구역">{detection.location}</Row>
                    <Row label="관련 작업">{detection.tbm.workType}</Row>
                  </dl>

                  <div className="well mt-3.5">
                    <p className="eyebrow">비교 대상 TBM 안전수칙</p>
                    {rule ? (
                      <>
                        <p className="mt-1.5 font-bold">
                          <span className="num text-ink-3">{rule.order}.</span> {rule.description}
                        </p>
                        <p className="mt-1 text-[13px] leading-6 text-ink-2">
                          위험 요인 · {rule.hazard} / 위험도 {SEVERITY_LABEL[rule.severity]} / 확정 시{" "}
                          <b style={{ color: "var(--deny)" }}>
                            <span className="num">−{rule.penalty}</span>점
                          </b>
                        </p>
                      </>
                    ) : (
                      <p className="mt-1.5 text-[13px] leading-6" style={{ color: "var(--hold)" }}>
                        오늘 TBM에 없는 항목입니다. 작업 특성상 필요한 보호구라면 다음 TBM에 추가하는
                        것을 검토해 주세요. 확정하면 기본 <span className="num">−10</span>점입니다.
                      </p>
                    )}
                  </div>

                  {detection.review ? (
                    <p className="mt-3 text-[13px] leading-6 text-ink-2">
                      <b className="text-ink">{detection.review.reviewedBy.name}</b> 판정
                      {detection.review.comment ? ` · ${detection.review.comment}` : ""}
                    </p>
                  ) : null}

                  <form action={reviewDetectionAction} className="mt-3.5">
                    <input type="hidden" name="detectionId" value={detection.id} />
                    <label className="sr-only" htmlFor={`comment-${detection.id}`}>
                      판단 근거
                    </label>
                    <input
                      id={`comment-${detection.id}`}
                      name="comment"
                      className="input"
                      placeholder="판단 근거나 시정 요청 (선택)"
                      defaultValue={detection.review?.comment ?? ""}
                    />
                    <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <button type="submit" name="decision" value="CONFIRMED" className="btn-deny">
                        위반 확정
                      </button>
                      <button type="submit" name="decision" value="FALSE_POSITIVE" className="btn-safe">
                        오탐
                      </button>
                      <button type="submit" name="decision" value="HOLD" className="btn-quiet">
                        판단 보류
                      </button>
                    </div>
                    {detection.status !== "PENDING" ? (
                      <p className="mt-2 text-[12px] text-ink-3">
                        이미 판정한 건입니다. 다시 누르면 판정이 바뀝니다.
                      </p>
                    ) : null}
                  </form>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

/** 기계가 뱉은 값. 어두운 판 위에 모노 대문자로. */
function MachineValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="scan opacity-60">{label}</dt>
      <dd className="scan">{value}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
