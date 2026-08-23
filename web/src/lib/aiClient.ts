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

/** 탐지 서비스가 공개 주소에 있을 때만 토큰을 쓴다. 로컬은 설정 없이 그대로 붙는다. */
function authHeaders(): HeadersInit | undefined {
  const token = process.env.AI_SERVICE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export class AiServiceError extends Error {}

/** 업로드된 현장 이미지를 PPE 탐지 모델에 넘긴다. */
export async function detectPpe(file: File, conf = 0.35): Promise<DetectResult> {
  const body = new FormData();
  body.append("file", file, file.name || "frame.jpg");
  body.append("conf", String(conf));

  let response: Response;
  try {
    response = await fetch(`${AI_SERVICE_URL}/detect`, {
      method: "POST",
      body,
      headers: authHeaders(),
    });
  } catch {
    throw new AiServiceError("AI 탐지 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  if (!response.ok) {
    throw new AiServiceError(`AI 탐지 서비스 오류 (HTTP ${response.status})`);
  }
  return (await response.json()) as DetectResult;
}

export async function aiHealth() {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/health`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!response.ok) return null;
    return (await response.json()) as { status: string; modelRepo: string; classes: string[] };
  } catch {
    return null;
  }
}
