import { requireManager } from "@/lib/auth";
import { managerFlow } from "@/lib/flow";
import { AppShell } from "@/components/AppShell";

/**
 * 안전관리자 화면의 껍데기.
 * 오늘의 흐름을 여기서 한 번만 계산해 레일에 넘긴다.
 *
 * 레이아웃은 searchParams 를 받지 못하므로 레일 숫자는 항상 오늘 기준이다.
 * "오늘의 흐름"이라는 제목과 뜻이 맞다 — 날짜를 옮겨 봐도 오늘 할 일은 그대로다.
 */
export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const manager = await requireManager();
  const flow = await managerFlow(manager.workplaceId);

  return (
    <AppShell
      user={manager}
      overviewHref="/manager"
      stages={flow.stages}
      switchTo={{ href: "/worker", label: "내 작업자 화면" }}
    >
      {children}
    </AppShell>
  );
}
