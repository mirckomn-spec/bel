import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSessionFromCookie } from "@/lib/auth";
import { getDbSafe } from "@/lib/mongodb";

const DEFAULT_MIN_WITHDRAW = 200;
const WITHDRAW_SETTINGS_FALLBACK_FILE = path.join(
  process.cwd(),
  "storage",
  "withdrawal-settings-fallback.json",
);

async function readFallbackSettings() {
  try {
    const raw = await readFile(WITHDRAW_SETTINGS_FALLBACK_FILE, "utf-8");
    return JSON.parse(raw) as { minWithdraw?: number };
  } catch {
    return {};
  }
}

async function writeFallbackSettings(data: { minWithdraw: number }) {
  await mkdir(path.dirname(WITHDRAW_SETTINGS_FALLBACK_FILE), { recursive: true });
  await writeFile(WITHDRAW_SETTINGS_FALLBACK_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });

  const { db } = await getDbSafe();
  if (!db) {
    const fallback = await readFallbackSettings();
    return NextResponse.json({
      minWithdraw: Number(fallback.minWithdraw ?? DEFAULT_MIN_WITHDRAW),
    });
  }

  const settings = await db
    .collection("settings")
    .findOne<{ minWithdraw?: unknown }>({ key: "withdrawals" });
  return NextResponse.json({
    minWithdraw: Number(settings?.minWithdraw ?? DEFAULT_MIN_WITHDRAW),
  });
}

export async function PATCH(request: Request) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Somente admin pode alterar o minimo." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { minWithdraw?: number } | null;
  const minWithdraw = Number(body?.minWithdraw);
  if (!Number.isFinite(minWithdraw) || minWithdraw < 0) {
    return NextResponse.json({ error: "Valor minimo invalido." }, { status: 400 });
  }

  const normalized = Number(minWithdraw.toFixed(2));
  const { db } = await getDbSafe();
  if (!db) {
    await writeFallbackSettings({ minWithdraw: normalized });
    return NextResponse.json({ ok: true, minWithdraw: normalized });
  }

  await db.collection("settings").updateOne(
    { key: "withdrawals" },
    {
      $set: {
        key: "withdrawals",
        minWithdraw: normalized,
        updatedAt: new Date(),
        updatedBy: session.username,
      },
    },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, minWithdraw: normalized });
}
