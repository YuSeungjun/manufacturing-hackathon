import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DateNav } from "@/components/DateNav";
import { SignatureList } from "@/components/SignatureList";
import { Empty, PageHead, SectionHead } from "@/components/ui";
import { dayRange, formatIsoDateKo, resolveDateParam, todayLocalISO } from "@/lib/date";

export default async function SignaturesPage({ searchParams }: PageProps<"/manager/signatures">) {
  const manager = await requireManager();

  const today = todayLocalISO();
  const iso = resolveDateParam((await searchParams).date);
  const isToday = iso === today;
  const dayLabel = isToday ? "오늘" : formatIsoDateKo(iso);
  const { from, to } = dayRange(iso);

  const tbms = await prisma.tbm.findMany({
    where: { workplaceId: manager.workplaceId, workDate: { gte: from, lt: to } },
    orderBy: { createdAt: "asc" },
    include: {
      team: true,
      acknowledgements: true,
      // 명단은 이 TBM 에 배정된 사람만. 같은 조라도 오늘 빠졌으면 나오지 않는다.
      assignees: { include: { user: true }, orderBy: { user: { name: "asc" } } },
    },
  });

  const totalExpected = tbms.reduce((n, t) => n + t.assignees.length, 0);
  const totalSigned = tbms.reduce((n, t) => {
    const ids = new Set(t.assignees.map((a) => a.userId));
    return n + t.acknowledgements.filter((a) => ids.has(a.userId)).length;
  }, 0);

  return (
    <>
      <PageHead
        stage={2}
        title="확인 서명"
        sub="작업자가 안전수칙을 읽고 서명했는지 봅니다. 서명은 작업 전에 하는 것이라 지난 날짜는 채울 수 없습니다."
        action={<DateNav basePath="/manager/signatures" iso={iso} today={today} />}
      />

      <p className="mt-4 text-[14px] text-ink-2">
        {dayLabel} 서명{" "}
        <b className="text-ink">
          <span className="num">{totalSigned}</span> / <span className="num">{totalExpected}</span>
        </b>
        명
      </p>

      {tbms.length === 0 ? (
        <div className="mt-4">
          <Empty>
            {dayLabel} 작업일의 TBM이 없어 서명 대상이 없습니다.{" "}
            <Link href="/manager/tbm/new" className="font-bold underline" style={{ color: "var(--act)" }}>
              TBM 작성하기
            </Link>
          </Empty>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {tbms.map((tbm) => {
            const ackAt = new Map(tbm.acknowledgements.map((a) => [a.userId, a.signedAt]));
            const signed = tbm.assignees.filter((a) => ackAt.has(a.userId)).length;
            const total = tbm.assignees.length;
            const complete = total > 0 && signed >= total;

            return (
              <section key={tbm.id}>
                <SectionHead
                  title={`${tbm.team.name} · ${tbm.workType}`}
                  count={
                    <span style={{ color: complete ? "var(--safe)" : "var(--hold)" }}>
                      <span className="num">{signed}</span>/<span className="num">{total}</span>명
                    </span>
                  }
                  action={
                    <Link
                      href={`/manager/tbm/${tbm.id}`}
                      className="text-[12.5px] font-bold text-ink-2 hover:text-ink"
                    >
                      TBM 보기
                    </Link>
                  }
                />
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
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
