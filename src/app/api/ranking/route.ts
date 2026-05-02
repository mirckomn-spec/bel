import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSessionFromCookie } from "@/lib/auth";
import { getDbSafe } from "@/lib/mongodb";
import { listMemberUsernames } from "@/lib/members";

const PROOFS_FALLBACK_FILE = path.join(process.cwd(), "storage", "proofs-fallback.json");
const RANKING_SETTINGS_FALLBACK_FILE = path.join(
  process.cwd(),
  "storage",
  "ranking-settings-fallback.json",
);

type ProofDoc = {
  uploader?: string;
  createdAt: string | Date;
  saleValue?: number;
};

type RankingSettings = {
  prizes: Record<"d1" | "d7" | "d14" | "d31", number>;
  valueOverridesByUser: Record<string, number>;
  resetAt: string | null;
};

const DEFAULT_PRIZES: RankingSettings["prizes"] = {
  d1: 0,
  d7: 0,
  d14: 0,
  d31: 150,
};

async function readFallbackProofs() {
  try {
    const raw = await readFile(PROOFS_FALLBACK_FILE, "utf-8");
    return JSON.parse(raw) as ProofDoc[];
  } catch {
    return [];
  }
}

async function readFallbackSettings(): Promise<RankingSettings> {
  try {
    const raw = await readFile(RANKING_SETTINGS_FALLBACK_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RankingSettings>;
    return {
      prizes: {
        d1: Number(parsed.prizes?.d1 ?? DEFAULT_PRIZES.d1),
        d7: Number(parsed.prizes?.d7 ?? DEFAULT_PRIZES.d7),
        d14: Number(parsed.prizes?.d14 ?? DEFAULT_PRIZES.d14),
        d31: Number(parsed.prizes?.d31 ?? DEFAULT_PRIZES.d31),
      },
      valueOverridesByUser: Object.fromEntries(
        Object.entries(
          (parsed as { valueOverridesByUser?: Record<string, number> }).valueOverridesByUser ??
            (parsed as { valueAdjustmentsByUser?: Record<string, number> }).valueAdjustmentsByUser ??
            {},
        ).map(([k, v]) => [
          String(k).toLowerCase(),
          Number(v ?? 0),
        ]),
      ),
      resetAt:
        parsed && "resetAt" in parsed && typeof parsed.resetAt === "string"
          ? parsed.resetAt
          : null,
    };
  } catch {
    return { prizes: DEFAULT_PRIZES, valueOverridesByUser: {}, resetAt: null };
  }
}

async function writeFallbackSettings(settings: RankingSettings) {
  await mkdir(path.dirname(RANKING_SETTINGS_FALLBACK_FILE), { recursive: true });
  await writeFile(RANKING_SETTINGS_FALLBACK_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

function rankByUploader(
  proofs: ProofDoc[],
  since: Date,
  members: string[],
  valueOverridesByUser: Record<string, number>,
  resetAt: string | null,
) {
  const map = new Map<string, { vendas: number; valorTotal: number }>();
  for (const member of members) {
    map.set(member, { vendas: 0, valorTotal: 0 });
  }
  for (const proof of proofs) {
    const created = new Date(proof.createdAt);
    if (created < since) continue;
    if (resetAt && created < new Date(resetAt)) continue;
    const user = String(proof.uploader ?? "").toLowerCase();
    if (!user || user === "bel") continue;
    const current = map.get(user) ?? { vendas: 0, valorTotal: 0 };
    current.vendas += 1;
    current.valorTotal += Number(proof.saleValue ?? 0);
    map.set(user, current);
  }
  return Array.from(map.entries())
    .map(([username, stats]) => ({
      username,
      vendas: stats.vendas,
      valorTotal:
        valueOverridesByUser[username] != null
          ? Number(Number(valueOverridesByUser[username]).toFixed(2))
          : Number(stats.valorTotal.toFixed(2)),
    }))
    .sort((a, b) => b.valorTotal - a.valorTotal || b.vendas - a.vendas);
}

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { db, error } = await getDbSafe();
  const proofs = db
    ? ((await db.collection("proofs").find({}).toArray()) as unknown as ProofDoc[])
    : await readFallbackProofs();

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const members = await listMemberUsernames();
  const settings = db
    ? (await db.collection("settings").findOne({ key: "ranking" })) as
        | {
            prizes?: Partial<RankingSettings["prizes"]>;
            valueOverridesByUser?: Record<string, number>;
            valueAdjustmentsByUser?: Record<string, number>;
            resetAt?: string | null;
          }
        | null
    : await readFallbackSettings();

  const prizes: RankingSettings["prizes"] = {
    d1: Number(settings?.prizes?.d1 ?? DEFAULT_PRIZES.d1),
    d7: Number(settings?.prizes?.d7 ?? DEFAULT_PRIZES.d7),
    d14: Number(settings?.prizes?.d14 ?? DEFAULT_PRIZES.d14),
    d31: Number(settings?.prizes?.d31 ?? DEFAULT_PRIZES.d31),
  };
  const valueOverridesByUser = Object.fromEntries(
    Object.entries(
      settings?.valueOverridesByUser ??
        (settings as { valueAdjustmentsByUser?: Record<string, number> } | null)
          ?.valueAdjustmentsByUser ??
        {},
    ).map(([k, v]) => [
      String(k).toLowerCase(),
      Number(v ?? 0),
    ]),
  );
  const resetAt = typeof settings?.resetAt === "string" ? settings.resetAt : null;

  const windows = {
    d1: rankByUploader(proofs, new Date(now - dayMs), members, valueOverridesByUser, resetAt),
    d7: rankByUploader(proofs, new Date(now - 7 * dayMs), members, valueOverridesByUser, resetAt),
    d14: rankByUploader(proofs, new Date(now - 14 * dayMs), members, valueOverridesByUser, resetAt),
    d31: rankByUploader(proofs, new Date(now - 31 * dayMs), members, valueOverridesByUser, resetAt),
  };

  return NextResponse.json({
    ...windows,
    prizes,
    valueOverridesByUser,
    resetAt,
    storage: db ? "mongodb" : "fallback",
    warning: db ? null : `Banco indisponivel: ${error}`,
  });
}

export async function PATCH(request: Request) {
  const session = await getSessionFromCookie();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | {
        username?: string;
        valueOverride?: number;
        prizeWindow?: "d1" | "d7" | "d14" | "d31";
        prizeValue?: number;
        resetRanking?: boolean;
      }
    | null;

  const { db } = await getDbSafe();
  let settings: RankingSettings;
  if (!db) {
    settings = await readFallbackSettings();
  } else {
    const row = (await db.collection("settings").findOne({ key: "ranking" })) as
      | {
          prizes?: Partial<RankingSettings["prizes"]>;
          valueOverridesByUser?: Record<string, number>;
          valueAdjustmentsByUser?: Record<string, number>;
          resetAt?: string | null;
        }
      | null;
    settings = {
      prizes: {
        d1: Number(row?.prizes?.d1 ?? DEFAULT_PRIZES.d1),
        d7: Number(row?.prizes?.d7 ?? DEFAULT_PRIZES.d7),
        d14: Number(row?.prizes?.d14 ?? DEFAULT_PRIZES.d14),
        d31: Number(row?.prizes?.d31 ?? DEFAULT_PRIZES.d31),
      },
      valueOverridesByUser: Object.fromEntries(
        Object.entries(
          row?.valueOverridesByUser ?? row?.valueAdjustmentsByUser ?? {},
        ).map(([k, v]) => [
          String(k).toLowerCase(),
          Number(v ?? 0),
        ]),
      ),
      resetAt: typeof row?.resetAt === "string" ? row.resetAt : null,
    };
  }

  if (body?.username && body?.valueOverride != null) {
    const username = String(body.username).trim().toLowerCase();
    settings.valueOverridesByUser[username] = Number(body.valueOverride ?? 0);
  }
  if (body?.prizeWindow && body?.prizeValue != null) {
    settings.prizes[body.prizeWindow] = Number(body.prizeValue ?? 0);
  }
  if (body?.resetRanking) {
    settings.valueOverridesByUser = {};
    settings.resetAt = new Date().toISOString();
  }

  if (!db) {
    await writeFallbackSettings(settings);
    return NextResponse.json({ ok: true, settings });
  }

  await db.collection("settings").updateOne(
    { key: "ranking" },
    {
      $set: {
        key: "ranking",
        prizes: settings.prizes,
        valueOverridesByUser: settings.valueOverridesByUser,
        resetAt: settings.resetAt,
        updatedAt: new Date(),
        updatedBy: session.username,
      },
    },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, settings });
}
