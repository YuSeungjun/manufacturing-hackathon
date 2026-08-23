import {
  INTERLOCK_LABEL,
  LEVEL_LABEL,
  LEVEL_MARK,
  RISK_STATUS_LABEL,
  RUN_STATE_LABEL,
} from "@/lib/zone";

/* ── 화면 머리 ─────────────────────────────────────────────
   단계 번호를 크게 달아 레일과 짝을 맞춘다. 어느 단계에 있는지
   본문만 봐도 알 수 있게. */

export function PageHead({
  stage,
  eyebrow,
  title,
  sub,
  action,
}: {
  stage?: number;
  eyebrow?: React.ReactNode;
  title: string;
  sub?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-rule pb-4">
      <div className="flex min-w-0 items-start gap-3">
        {stage ? (
          <span
            aria-hidden
            className="sign shrink-0 text-[2rem] leading-none text-ink-3 sm:text-[2.375rem]"
          >
            {stage}
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1.5 flex flex-wrap items-center gap-2">{eyebrow}</div> : null}
          <h1 className="h1">
            {stage ? <span className="sr-only">{stage}단계 </span> : null}
            {title}
          </h1>
          {sub ? <p className="mt-1.5 max-w-2xl text-[13.5px] leading-6 text-ink-2">{sub}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** 섹션 제목 한 줄. 괘선으로 구간을 연다. */
export function SectionHead({
  title,
  count,
  action,
}: {
  title: string;
  count?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-4">
      <h2 className="h2">
        {title}
        {count != null ? (
          <span className="ml-2 text-[13px] font-medium text-ink-3">{count}</span>
        ) : null}
      </h2>
      {action}
    </div>
  );
}

/* ── 표식 ─────────────────────────────────────────────────
   판정은 사람이 내린 결론이라 도장으로, 그 외 상태는 납작한 꼬리표로. */

const STATUS_TAG: Record<string, string> = {
  PENDING: "tag-hold",
  CONFIRMED: "tag-deny",
  FALSE_POSITIVE: "tag-safe",
  HOLD: "tag-act",
};

export function StatusTag({ status }: { status: string }) {
  return (
    <span className={`tag ${STATUS_TAG[status] ?? ""}`}>
      <span className="dot" aria-hidden />
      {RISK_STATUS_LABEL[status] ?? status}
    </span>
  );
}

const STATUS_STAMP: Record<string, string> = {
  CONFIRMED: "stamp-deny",
  FALSE_POSITIVE: "stamp-safe",
  HOLD: "stamp-hold",
};

/** 사람이 판정을 마친 자리에만 찍힌다. 검토 대기에는 쓰지 않는다. */
export function JudgmentStamp({ decision }: { decision: string }) {
  const tone = STATUS_STAMP[decision];
  if (!tone) return null;
  return <span className={`stamp ${tone}`}>{RISK_STATUS_LABEL[decision] ?? decision}</span>;
}

/** 라벨 + 계측값 한 쌍. 좁은 자리에 늘어놓는다. */
export function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[11.5px] font-bold text-ink-3">{label}</span>
      <span className="num text-[13px] font-bold text-ink-2">{value}</span>
    </span>
  );
}

/* ── 빈 상태 ───────────────────────────────────────────────
   비어 있는 화면은 분위기가 아니라 다음 할 일을 알려 준다. */

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-rule px-4 py-7 text-center text-[13.5px] leading-6 text-ink-3">
      {children}
    </p>
  );
}

/* ── 설비와 인터록 ─────────────────────────────────────────
   인터록은 이 앱에서 가장 중요한 한 글자다. 색만으로 말하지 않고
   기호와 낱말을 함께 쓴다. */

export function InterlockBadge({ interlock, reason }: { interlock: string; reason?: string }) {
  const blocked = interlock === "BLOCKED";
  return (
    <span
      className={`tag ${blocked ? "tag-deny" : "tag-safe"}`}
      title={blocked && reason ? reason : undefined}
    >
      <span aria-hidden>{blocked ? "⛔" : "✓"}</span>
      {INTERLOCK_LABEL[interlock] ?? interlock}
    </span>
  );
}

export function RunStateTag({ state }: { state: string }) {
  const tone = state === "RUNNING" ? "tag-act" : state === "MAINTENANCE" ? "tag-hold" : "";
  return (
    <span className={`tag ${tone}`}>
      <span className="dot" aria-hidden />
      {RUN_STATE_LABEL[state] ?? state}
    </span>
  );
}

/** AI 가 매긴 위험 수준. 사람의 판정(StatusTag)과 다른 축이라 모양을 달리한다. */
export function LevelTag({ level }: { level: string }) {
  const tone =
    level === "CRITICAL" ? "tag-deny" : level === "WARNING" ? "tag-hold" : level === "CAUTION" ? "tag-act" : "";
  return (
    <span className={`tag ${tone}`}>
      <span aria-hidden>{LEVEL_MARK[level] ?? "·"}</span>
      {LEVEL_LABEL[level] ?? level}
    </span>
  );
}
