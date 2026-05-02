import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const AUTH_COOKIE = "hots_auth";

type JwtRole = "admin" | "member";
type DecodedPayload = {
  role?: unknown;
  username?: unknown;
};

function resolveRole(decoded: DecodedPayload): JwtRole {
  if (decoded.role === "admin") return "admin";
  if (decoded.role === "member") return "member";
  const user = String(decoded.username ?? "").toLowerCase();
  return user === "bel" ? "admin" : "member";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const needsAuth =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/painel") ||
    pathname.startsWith("/api/proofs") ||
    pathname.startsWith("/api/ranking") ||
    pathname.startsWith("/api/profile") ||
    pathname.startsWith("/api/fines") ||
    pathname.startsWith("/api/goals") ||
    pathname.startsWith("/api/hots-access") ||
    pathname.startsWith("/api/admin");

  if (!needsAuth) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const secret = process.env.JWT_SECRET;

  if (!token || !secret) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  let role: JwtRole;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    const decoded = payload as DecodedPayload;
    role = resolveRole(decoded);
  } catch {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname.startsWith("/dashboard") && role !== "admin") {
    return NextResponse.redirect(new URL("/painel", request.url));
  }

  if (pathname.startsWith("/painel") && role !== "member") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/api/admin") && role !== "admin") {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/painel",
    "/painel/:path*",
    "/api/proofs/:path*",
    "/api/ranking",
    "/api/profile/:path*",
    "/api/fines/:path*",
    "/api/goals",
    "/api/hots-access",
    "/api/admin",
    "/api/admin/:path*",
  ],
};
