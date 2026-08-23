import Link from "next/link";
import { formatDate, formatTime } from "@/lib/date";
import { notFound } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SignatureList } from "@/components/SignatureList";
import { Empty, PageHead, SectionHead, StatusTag } from "@/components/ui";
import { DETECTION_TYPE_LABEL, SEVERITY_LABEL, ppeLabel } from "@/lib/ppe";

const SEVERITY_TAG: Record<string, string> = {
  HIGH: "tag-deny",
  MEDIUM: "tag-hold",
  LOW: "",
};

export default async function TbmDetailPage({ params }: PageProps<"/manager/tbm/[id]">) {
  const manager = await requireManager();
  const { id } = await params;

  const tbm = await prisma.tbm.findFirst({
    where: { id, workplaceId: manager.workplaceId },
    include: {
      rules: { orderBy: { order: "asc" } },
      createdBy: true,
      team: true,
      acknowledgements: true,
      // 명단은 이 TBM 에 배정된 사람만.
      assignees: { include: { user: true }, orderBy: { user: { name: "asc" } } },
      detections: { orderBy: { detectedAt: "desc" }, include: { safetyRule: true } },
    },
  });
  if (!tbm) notFound();

  const ackAt = new Map(tbm.acknowledgements.map((a) => [a.userId, a.signedAt]));
  const signed = tbm.assignees.filter((a) => ackAt.has(a.userId)).length;

  return (
    <>
      <Link href="/manager" className="text-[12.5px] text-ink-3 hover:text-ink">
        ← 현황판
      </Link>

      <div className="mt-2.5">
        <PageHead
          eyebrow={
            <>
              <span className="text-[12px] text-ink-3">
                {formatDate(tbm.workDate)}
              </span>
              <span className="tag">{tbm.team.name}</span>
              <span className="tag">{tbm.workArea}</span>
            </>
          }
          title={tbm.workType}
          sub={`작성 ${tbm.createdBy.name}`}
          action={
            <Link href="/manager/analyze" className="btn-quiet btn-sm">
              이 구역 영상 분석
            </Link>
          }
        />
      </div>

      {tbm.summary ? <p className="paper mt-4 text-[14px] leading-7">{tbm.summary}</p> : null}

      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div>
          <SectionHead title="안전수칙" count={`${tbm.rules.length}개`} />
          <ol className="paper-flush ruled">
            {tbm.rules.map((rule) => (
              <li key={rule.id} className="flex items-start gap-3 px-4 py-3">
                <span className="num mt-0.5 w-4 shrink-0 text-[12.5px] font-bold text-ink-3">
                  {rule.order}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="font-bold">{rule.description}</p>
                    <span className="text-[12px] font-bold text-ink-3">
                      <span className="num">−{rule.penalty}</span>점
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-6 text-ink-2">위험 요인 · {rule.hazard}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className={`tag ${SEVERITY_TAG[rule.severity] ?? ""}`}>
                      위험도 {SEVERITY_LABEL[rule.severity]}
                    </span>
                    <span className={`tag ${rule.ppeCode ? "tag-act" : ""}`}>
                      {DETECTION_TYPE_LABEL[rule.detectionType]}
                      {rule.ppeCode ? ` · AI ${ppeLabel(rule.ppeCode)}` : ""}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <SectionHead title="확인 서명" count={`${signed}/${tbm.assignees.length}명`} />
          <div className="paper-flush">
            <SignatureList
              rows={tbm.assignees.map(({ user }) => ({
                id: user.id,
                name: user.name,
                employeeNumber: user.employeeNumber,
                signedAt: ackAt.get(user.id) ?? null,
              }))}
            />
          </div>
        </div>
      </section>

      <section className="mt-7">
        <SectionHead title="연결된 AI 탐지" count={`${tbm.detections.length}건`} />
        {tbm.detections.length === 0 ? (
          <Empty>아직 이 TBM에 연결된 탐지 기록이 없습니다.</Empty>
        ) : (
          <ul className="paper-flush ruled">
            {tbm.detections.map((detection) => (
              <li key={detection.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
                <span className="num text-[12px] text-ink-3">
                  {formatTime(detection.detectedAt)}
                </span>
                <b className="text-[14px]">{ppeLabel(detection.ppeCode)}</b>
                <span className="text-[12.5px] text-ink-3">
                  <span className="num">{Math.round(detection.confidence * 100)}%</span>
                  {detection.safetyRule ? ` · 수칙 ${detection.safetyRule.order}번` : " · TBM 미기재"}
                </span>
                <Link href="/manager/detections?status=ALL" className="ml-auto">
                  <StatusTag status={detection.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
