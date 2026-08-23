import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

/**
 * CCTV 캡처 이미지·영상 직업로드 토큰.
 *
 * Vercel Function 요청 본문은 4.5MB 가 하드 리밋이라 파일을 서버 액션으로 중계할 수 없다.
 * 브라우저 → Blob 으로 바로 올리고, 서버 액션에는 URL 만 넘긴다.
 *
 * 이 라우트는 토큰만 발급한다. 실제 바이트는 여기를 지나가지 않는다.
 */

/** 이미지 시퀀스는 frames/ 로, 영상은 clips/ 로 올라간다. 허용 타입과 크기가 다르다. */
const FRAME_PREFIX = "frames/";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

// 이미지 한도는 AI 서비스의 MAX_IMAGE_MB(12) 와 맞춘다. 여기서 넉넉히 받아 두면
// 업로드가 끝난 뒤 분석 단계에서 거절당한다 — 실패를 늦게 알리는 쪽이 더 나쁘다.
const IMAGE_LIMIT = 12 * 1024 * 1024;
const VIDEO_LIMIT = 80 * 1024 * 1024;
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
      onBeforeGenerateToken: async (pathname) => {
        const isFrame = pathname.startsWith(FRAME_PREFIX);
        return {
          allowedContentTypes: isFrame ? IMAGE_TYPES : VIDEO_TYPES,
          addRandomSuffix: true,
          maximumSizeInBytes: isFrame ? IMAGE_LIMIT : VIDEO_LIMIT,
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
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
