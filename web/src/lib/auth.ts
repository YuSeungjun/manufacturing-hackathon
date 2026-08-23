import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "tbm_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET 환경변수가 없습니다.");
  return new TextEncoder().encode(value);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export async function getSessionUser() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string") return null;
    userId = payload.sub;
  } catch {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: userId },
    include: { workplace: true, team: true },
  });
}

/** 로그인한 사용자를 보장한다. 없으면 로그인 화면으로 보낸다. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * 안전관리자 권한을 보장한다.
 * 화면에서 버튼을 숨기는 것과 별개로, 서버에서 반드시 한 번 더 검사한다.
 */
export async function requireManager() {
  const user = await requireUser();
  if (user.role !== "SAFETY_MANAGER" || user.approvalStatus !== "APPROVED") {
    redirect("/forbidden");
  }
  return user;
}

/** 서버 액션에서 쓰는 권한 검사. 리다이렉트 대신 예외를 던진다. */
export async function assertManager() {
  const user = await getSessionUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  if (user.role !== "SAFETY_MANAGER" || user.approvalStatus !== "APPROVED") {
    throw new Error("안전관리자 권한이 필요합니다. (403 Forbidden)");
  }
  return user;
}

export function homePathFor(user: { role: string; approvalStatus: string }) {
  if (user.role === "SAFETY_MANAGER") {
    return user.approvalStatus === "APPROVED" ? "/manager" : "/pending";
  }
  return "/worker";
}
