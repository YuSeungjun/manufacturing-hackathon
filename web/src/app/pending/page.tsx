import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function PendingPage() {
  const user = await requireUser();

  return (
    <>
      <header className="mx-auto flex h-14 w-full max-w-lg items-center px-5">
        <span className="text-[15px] font-extrabold tracking-[-0.02em]">5조 대시보드</span>
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-16">
        <div className="rounded-lg border-2 bg-paper p-5" style={{ borderColor: "var(--hold)" }}>
          <p className="eyebrow">승인 대기</p>
          <h1 className="mt-2 text-[1.25rem] font-bold leading-snug tracking-[-0.01em]">
            {user.name} 님의 안전관리자 권한을 확인하고 있습니다
          </h1>
          <p className="mt-3 text-[14px] leading-7 text-ink-2">
            안전관리자 권한은 소속 확인 후 부여됩니다. 승인 전까지는 작업자 화면만 이용할 수
            있습니다. 사업장 인증번호를 알고 있다면 다시 가입하지 말고 안전관리팀에 승인을 요청해
            주세요.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/worker" className="btn-act">
              작업자 화면 보기
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="btn-quiet">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}
