import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { fetchCapture } from "@/lib/aiClient";

/**
 * AI 캡처 프록시.
 *
 * <img> 는 Authorization 헤더를 못 보낸다. 캡처 URL 에 토큰을 박으면 브라우저에 새어 나가므로
 * 여기서 대신 붙인다. 확정되지 않은 사건의 캡처는 아직 AI 서비스에만 있고 휘발성이다.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { path } = await ctx.params;
  // jobId/captureId 두 조각만 허용한다. 경로 조작을 막는다.
  if (path.length !== 2 || path.some((p) => p.includes("/") || p.startsWith("."))) {
    return NextResponse.json({ error: "잘못된 캡처 주소입니다." }, { status: 400 });
  }

  const fetched = await fetchCapture(`/captures/${path[0]}/${path[1]}`);
  if (!fetched) {
    return NextResponse.json({ error: "캡처를 찾을 수 없습니다." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(fetched.bytes), {
    headers: {
      "Content-Type": fetched.contentType,
      // 사건마다 주소가 유일하고, AI 쪽 원본은 30분 뒤 사라진다
      "Cache-Control": "private, max-age=1800",
    },
  });
}
