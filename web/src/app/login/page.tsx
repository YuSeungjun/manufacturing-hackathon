import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginForm } from "./LoginForm";

const FLOW = [
  "안전관리자가 압연설비 위험구역을 카메라 화면 위에 그려 둔다",
  "AI가 CCTV 영상에서 작업자를 추적해 구역 잔류를 잰다",
  "잔류 중 재가동 명령이 겹치면 재가동을 즉시 차단한다",
  "위험 순간을 자동 캡처해 안전관리자에게 통보한다",
  "현장 확인 후 안전관리자가 승인해야 다시 돌아간다",
];

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user));

  return (
    <>
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center px-5">
        <span className="text-[15px] font-extrabold tracking-[-0.02em]">안전한 재가동</span>
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 content-center gap-10 px-5 py-8 md:grid-cols-[1.05fr_1fr] md:py-12">
        <section className="hidden md:block">
          <p className="eyebrow">제철소 압연설비 끼임 예방</p>
          <h1 className="mt-2.5 text-[2.375rem] font-extrabold leading-[1.15] tracking-[-0.035em]">
            사람이 남아 있으면
            <br />
            설비는 돌지 않는다
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-7 text-ink-2">
            정비 중 불시 재가동으로 인한 끼임을 막습니다. AI는 알림에서 멈추지 않고 재가동
            자체를 차단하고, 해제는 현장을 확인한 사람만 할 수 있습니다.
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
