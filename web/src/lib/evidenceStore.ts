import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 근거 이미지 보관.
 *
 * 로컬에서는 public/evidence 에 그대로 쓴다.
 * 배포(Vercel)는 파일시스템이 읽기 전용이라 Blob 저장소로 보낸다.
 * 토큰 유무로 갈라서, 로컬 개발은 아무 설정 없이 지금처럼 돌아간다.
 */

const LOCAL_DIR = path.join(process.cwd(), "public", "evidence");

function safeName(originalName: string, fallbackExt = "jpg") {
  const ext = originalName.split(".").pop()?.toLowerCase() ?? fallbackExt;
  return `${randomUUID()}.${ext.replace(/[^a-z0-9]/g, "") || fallbackExt}`;
}

/** 저장하고 화면에서 쓸 주소를 돌려준다. */
export async function storeEvidence(file: File, prefix = "evidence"): Promise<string> {
  return storeEvidenceBytes(
    Buffer.from(await file.arrayBuffer()),
    safeName(file.name),
    file.type || "image/jpeg",
    prefix,
  );
}

/**
 * AI 가 만든 캡처처럼 File 이 아닌 바이트를 보관한다.
 *
 * AI 서비스의 캡처는 휘발성이다 — HF Space 는 재시작하면 디스크가 날아간다.
 * 안전관리자가 위험으로 확정한 건만 여기를 거쳐 영구 보관된다.
 */
export async function storeEvidenceBytes(
  bytes: Buffer,
  fileName: string,
  contentType: string,
  prefix = "evidence",
): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`${prefix}/${fileName}`, bytes, { access: "public", contentType });
    return blob.url;
  }

  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_DIR, fileName), bytes);
  return `/evidence/${fileName}`;
}

export function extensionFor(contentType: string) {
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("mp4")) return "mp4";
  return "jpg";
}
