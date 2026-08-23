import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

/**
 * CCTV 영상 직업로드 토큰.
 *
 * Vercel Function 요청 본문은 4.5MB 가 하드 리밋이라 영상을 서버 액션으로 중계할 수 없다.
 * 브라우저 → Blob 으로 바로 올리고, 서버 액션에는 URL 만 넘긴다.
 *
 * 이 라우트는 토큰만 발급한다. 실제 바이트는 여기를 지나가지 않는다.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user || user.role !== "SAFETY_MANAGER" || user.approvalStatus !== "APPROVED") {
    return NextResponse.json({ error: "안전관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime"],
        addRandomSuffix: true,
        maximumSizeInBytes: 80 * 1024 * 1024,
        tokenPayload: JSON.stringify({ userId: user.id }),
      }),
      // 로컬 개발에서는 Vercel 이 이 콜백을 호출할 수 없다. 업로드 자체는 정상 동작한다.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "업로드 준비에 실패했습니다." },
      { status: 400 },
    );
  }
}
