import type { Metadata, Viewport } from "next";
import { Black_Han_Sans, Gothic_A1, Roboto_Mono } from "next/font/google";
import "./globals.css";

/** 표지 서체 — 점수와 단계 번호에만. 한국 산업 표지판의 목소리. */
const sign = Black_Han_Sans({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-sign",
  display: "swap",
  preload: false,
});

/** 말하는 글자. */
const gothic = Gothic_A1({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-gothic",
  display: "swap",
  // 한글은 유니코드 구간이 수백 개로 나뉜다. 전부 preload 하면 링크만 수백 줄이 된다.
  preload: false,
});

/** 계측하는 글자 — 사번, 시각, 신뢰도, 카메라 ID. */
const robomono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-robomono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "5조 대시보드 · 제철소 이송·회전설비 끼임 예방",
  description:
    "AI가 컨베이어 위험구역의 작업자 잔류를 감지해 불시 재가동을 차단하고, 같은 상황이 몇 번 반복되는지까지 남깁니다.",
};

export const viewport: Viewport = {
  // viewport 를 직접 내보내면 Next 의 기본값을 덮어쓴다. 폭 설정을 반드시 같이 적는다.
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edeff3" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1317" },
  ],
};

/**
 * 저장해 둔 테마를 첫 페인트 전에 적용한다.
 * 이 스크립트가 없으면 다크를 고른 사람에게 흰 화면이 한 번 번쩍인다.
 */
const THEME_INIT = `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`h-full antialiased ${gothic.variable} ${sign.variable} ${robomono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
