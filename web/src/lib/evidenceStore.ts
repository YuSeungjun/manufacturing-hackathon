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

function safeName(originalName: string) {
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "jpg";
  return `${randomUUID()}.${ext.replace(/[^a-z0-9]/g, "") || "jpg"}`;
}

/** 저장하고 화면에서 쓸 주소를 돌려준다. */
export async function storeEvidence(file: File): Promise<string> {
  const fileName = safeName(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`evidence/${fileName}`, bytes, {
      access: "public",
      contentType: file.type || "image/jpeg",
    });
    return blob.url;
  }

  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_DIR, fileName), bytes);
  return `/evidence/${fileName}`;
}
