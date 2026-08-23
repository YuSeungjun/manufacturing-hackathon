import { requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHead } from "@/components/ui";
import { TbmForm } from "./TbmForm";

export default async function NewTbmPage() {
  const manager = await requireManager();

  // 서명 대상 후보 — 승인된 작업자만. 관리자는 TBM 을 쓰는 쪽이라 명단에 넣지 않는다.
  const teams = await prisma.team.findMany({
    where: { workplaceId: manager.workplaceId },
    orderBy: { name: "asc" },
    include: {
      users: {
        where: { role: "WORKER", approvalStatus: "APPROVED" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, employeeNumber: true },
      },
    },
  });

  return (
    <>
      <PageHead
        stage={1}
        title="TBM 작성"
        sub="오늘 할 작업, 위험 요인, 안전 대책을 적고 오늘 투입되는 작업자를 고릅니다. 보호구 항목을 AI 확인으로 지정하면 영상 분석 결과와 자동으로 연결됩니다."
      />
      <TbmForm
        teams={teams.map((t) => ({
          id: t.id,
          name: t.name,
          workArea: t.workArea,
          workers: t.users,
        }))}
      />
    </>
  );
}
