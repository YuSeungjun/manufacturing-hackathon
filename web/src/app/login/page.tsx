import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user));

  return (
    <>
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center px-5">
        <span className="text-[15px] font-extrabold tracking-[-0.02em]">5조 대시보드</span>
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 content-center gap-10 px-5 py-8 md:grid-cols-[1.05fr_1fr] md:py-12">
        <section className="hidden md:block">
          <p className="eyebrow">제철소 이송·회전설비 끼임 예방</p>
          <h1 className="mt-2.5 text-[2.375rem] font-extrabold leading-[1.15] tracking-[-0.035em]">
            사람이 남아 있으면
            <br />
            설비는 돌지 않는다
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-7 text-ink-2">통합 관리 대시보드</p>
        </section>

        <section className="paper">
          <h2 className="h2">로그인</h2>
          <p className="mt-1 text-[13px] text-ink-2">사번과 비밀번호를 입력해 주세요.</p>
          <LoginForm />
          <p className="mt-5 text-[13px] text-ink-2">
            계정이 없으신가요?{" "}
            <Link href="/signup" className="font-bold underline underline-offset-2" style={{ color: "var(--act)" }}>
              회원가입
            </Link>
          </p>

          <div className="well mt-5">
            <p className="eyebrow">데모 계정</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-ink-3">안전관리자</dt>
              <dd className="num">M0001 / test1234</dd>
              <dt className="text-ink-3">작업자</dt>
              <dd className="num">W1001 / test1234</dd>
            </dl>
          </div>
        </section>
      </main>
    </>
  );
}
