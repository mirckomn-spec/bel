import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSessionFromCookie } from "@/lib/auth";
import { getDbSafe } from "@/lib/mongodb";

const AVATAR_FALLBACK_META = path.join(process.cwd(), "storage", "avatar-fallback.json");

type AvatarMeta = Record<
  string,
  {
    avatarUrl: string;
  }
>;

async function readAvatarMeta() {
  try {
    const raw = await readFile(AVATAR_FALLBACK_META, "utf-8");
    return JSON.parse(raw) as AvatarMeta;
  } catch {
    return {};
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ username: string }> },
) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { username } = await context.params;
  const normalized = username.toLowerCase();

  if (normalized === "bel") {
    return NextResponse.json({ error: "Avatar nao disponivel." }, { status: 404 });
  }

  const { db } = await getDbSafe();
  if (!db) {
    const meta = await readAvatarMeta();
    const item = meta[normalized];
    if (!item) {
      return NextResponse.json({ error: "Avatar nao encontrado." }, { status: 404 });
    }
    return NextResponse.redirect(item.avatarUrl);
  }

  const profile = await db
    .collection("profiles")
    .findOne<{ avatarUrl?: string }>({
      username: normalized,
    });
  if (!profile?.avatarUrl) {
    return NextResponse.json({ error: "Avatar nao encontrado." }, { status: 404 });
  }

  return NextResponse.redirect(profile.avatarUrl);
}
