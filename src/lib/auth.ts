import "server-only";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

export const AUTH_COOKIE_NAME = "hots_auth";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export type UserRole = "admin" | "member";

export type SessionPayload = {
  userId: string;
  username: string;
  role: UserRole;
};

function resolveRoleFromPayload(payload: jwt.JwtPayload): UserRole {
  if (payload.role === "admin") return "admin";
  if (payload.role === "member") return "member";
  const user = String(payload.username ?? "").toLowerCase();
  return user === "bel" ? "admin" : "member";
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Defina JWT_SECRET nas variaveis de ambiente.");
  }
  return secret;
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  };
}

export function signSessionToken(payload: SessionPayload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "30d" });
}

export async function createSessionCookie(payload: SessionPayload) {
  const token = signSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, getSessionCookieOptions());
  return token;
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, "", {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });
}

export async function getSessionFromCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    return {
      userId: String(decoded.userId ?? decoded.username ?? ""),
      username: String(decoded.username ?? "").toLowerCase(),
      role: resolveRoleFromPayload(decoded),
    };
  } catch {
    return null;
  }
}
