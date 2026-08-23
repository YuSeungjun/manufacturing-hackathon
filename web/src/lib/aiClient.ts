import "server-only";
import type { DetectionBox } from "@/lib/ppe";

export type DetectResult = {
  modelRepo: string;
  imageWidth: number;
  imageHeight: number;
  personCount: number;
  boxes: DetectionBox[];
  violationCodes: string[];
};

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000";

export class AiServiceError extends Error {}

/** 업로드된 현장 이미지를 PPE 탐지 모델에 넘긴다. */
export async function detectPpe(file: File, conf = 0.35): Promise<DetectResult> {
  const body = new FormData();
  body.append("file", file, file.name || "frame.jpg");
  body.append("conf", String(conf));

  let response: Response;
  try {
    response = await fetch(`${AI_SERVICE_URL}/detect`, { method: "POST", body });
  } catch {
    throw new AiServiceError(
      `AI 탐지 서비스(${AI_SERVICE_URL})에 연결하지 못했습니다. ai/run.sh 를 실행했는지 확인해 주세요.`,
    );
  }

  if (!response.ok) {
    throw new AiServiceError(`AI 탐지 서비스 오류 (HTTP ${response.status})`);
  }
  return (await response.json()) as DetectResult;
}

export async function aiHealth() {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/health`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as { status: string; modelRepo: string; classes: string[] };
  } catch {
    return null;
  }
}
