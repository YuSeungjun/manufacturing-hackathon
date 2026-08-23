import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginForm } from "./LoginForm";

const FLOW = [
  "안전관리자가 TBM에 위험 요인과 안전 대책을 적는다",
  "작업자가 안전수칙을 읽고 확인 서명한다",
  "현장 영상에서 AI가 보호구 착용 여부를 확인한다",
  "안전관리자가 위반 확정 · 오탐을 판정한다",
  "확정된 건만 안전이행 점수에 반영된다",
];

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user));

  return (
    <>
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center px-5">
        <span className="text-[15px] font-extrabold tracking-[-0.02em]">안전한 하루</span>
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 content-center gap-10 px-5 py-8 md:grid-cols-[1.05fr_1fr] md:py-12">
        <section className="hidden md:block">
          <p className="eyebrow">제철소 작업 전 안전점검회의</p>
          <h1 className="mt-2.5 text-[2.375rem] font-extrabold leading-[1.15] tracking-[-0.035em]">
            수기로 끝나던 TBM을
            <br />
            지켜지는 TBM으로
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-7 text-ink-2">
            오늘 작성한 안전수칙을 AI가 현장 영상에서 확인하고, 위반이 의심되면 안전관리자에게
            알립니다. 최종 판단은 언제나 사람이 합니다.
          </p>

          {/* 흐름 자체가 순서를 가지므로 번호를 붙인다. */}
          <ol className="mt-7 border-t border-rule">
            {FLOW.map((step, i) => (
              <li key={step} className="flex gap-3.5 border-b border-rule py-2.5">
                <span className="num shrink-0 text-[12px] font-bold text-ink-3">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[13.5px] leading-6 text-ink-2">{step}</span>
              </li>
            ))}
          </ol>
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
