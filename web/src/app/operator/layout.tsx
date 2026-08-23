import { requireOperator } from "@/lib/auth";
import { operatorFlow } from "@/lib/flow";
import { AppShell } from "@/components/AppShell";

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const operator = await requireOperator();
  const flow = await operatorFlow(operator.workplaceId, operator.id);

  return (
    <AppShell
      user={operator}
      overviewHref="/operator"
      stages={flow.stages}
      switchTo={
        operator.role === "SAFETY_MANAGER"
          ? { href: "/manager", label: "안전관리자 화면" }
          : undefined
      }
    >
      {children}
    </AppShell>
  );
}
