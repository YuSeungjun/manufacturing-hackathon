import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-16">
      <div className="rounded-lg border-2 bg-paper p-5" style={{ borderColor: "var(--deny)" }}>
        <p className="eyebrow">403 Forbidden</p>
        <h1 className="mt-2 text-[1.25rem] font-bold leading-snug tracking-[-0.01em]">
          안전관리자 권한이 필요한 화면입니다
        </h1>
        <p className="mt-3 text-[14px] leading-7 text-ink-2">
          위험구역 설정, 영상 분석, 위험 사건 판단, 재가동 해제 승인은 승인된 안전관리자만 할 수
          있습니다. 화면에서 버튼을 숨기는 것과 별개로 서버에서도 권한을 확인합니다.
        </p>
        <Link href="/" className="btn-act mt-5">
          내 화면으로 돌아가기
        </Link>
      </div>
    </main>
  );
}
