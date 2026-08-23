import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser, homePathFor } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignupForm } from "./SignupForm";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user));

  const workplaces = await prisma.workplace.findMany({
    orderBy: { name: "asc" },
    include: { teams: { orderBy: { name: "asc" } } },
  });

  return (
    <>
      <header className="mx-auto flex h-14 w-full max-w-xl items-center px-5">
        <Link href="/login" className="text-[13px] text-ink-3 hover:text-ink">
          ← 로그인으로
        </Link>
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-12">
        <h1 className="h1">회원가입</h1>
        <p className="mt-1.5 text-[14px] leading-6 text-ink-2">
          소속과 역할을 선택하면 역할에 맞는 화면으로 이동합니다.
        </p>

        <SignupForm
          workplaces={workplaces.map((w) => ({
            id: w.id,
            name: w.name,
            teams: w.teams.map((t) => ({ id: t.id, name: t.name, workArea: t.workArea })),
          }))}
        />
      </main>
    </>
  );
}
