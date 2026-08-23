import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getJob, AiServiceError } from "@/lib/aiClient";

/**
 * 분석 진행률 폴링.
 *
 * 서버 액션은 클라이언트에 진행 상황을 흘려보낼 수 없어서 라우트 핸들러를 하나 판다.
 * 프레임 타임라인까지 통째로 돌려주면 응답이 무거우니 진행률만 추린다.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "SAFETY_MANAGER") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { jobId } = await ctx.params;
  try {
    const job = await getJob(jobId);
    return NextResponse.json(
      {
        status: job.status,
        progress: job.progress,
        processedFrames: job.processedFrames,
        totalFrames: job.totalFrames,
        error: job.error,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof AiServiceError ? error.message : "분석 상태를 확인하지 못했습니다.";
    return NextResponse.json({ status: "ERROR", error: message }, { status: 502 });
  }
}
