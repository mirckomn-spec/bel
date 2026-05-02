import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDbSafe } from "@/lib/mongodb";

export type MemberControlDoc = {
  username: string;
  balanceAdjustment: number;
  dailyProgressOverride: number | null;
  streakOverride: number | null;
  commissionPercentOverride: number | null;
  updatedAt: string;
  updatedBy: string;
};

const FALLBACK_FILE = path.join(process.cwd(), "storage", "member-controls-fallback.json");

async function readFallback() {
  try {
    const raw = await readFile(FALLBACK_FILE, "utf-8");
    return JSON.parse(raw) as MemberControlDoc[];
  } catch {
    return [];
  }
}

async function writeFallback(items: MemberControlDoc[]) {
  await mkdir(path.dirname(FALLBACK_FILE), { recursive: true });
  await writeFile(FALLBACK_FILE, JSON.stringify(items, null, 2), "utf-8");
}

export async function getAllMemberControls() {
  const { db } = await getDbSafe();
  if (!db) return readFallback();
  const rows = await db.collection("member_controls").find({}).toArray();
  return rows.map((row) => ({
    username: String(row.username ?? "").toLowerCase(),
    balanceAdjustment: Number(row.balanceAdjustment ?? 0),
    dailyProgressOverride:
      row.dailyProgressOverride == null ? null : Number(row.dailyProgressOverride),
    streakOverride: row.streakOverride == null ? null : Number(row.streakOverride),
    commissionPercentOverride:
      row.commissionPercentOverride == null ? null : Number(row.commissionPercentOverride),
    updatedAt: new Date(row.updatedAt ?? new Date()).toISOString(),
    updatedBy: String(row.updatedBy ?? "system"),
  }));
}

export async function upsertMemberControl(
  username: string,
  patch: Partial<Omit<MemberControlDoc, "username" | "updatedAt" | "updatedBy">>,
  updatedBy: string,
) {
  const normalized = username.toLowerCase().trim();
  const { db } = await getDbSafe();
  if (!db) {
    const items = await readFallback();
    const idx = items.findIndex((item) => item.username === normalized);
    const prev: MemberControlDoc =
      idx >= 0
        ? items[idx]
        : {
            username: normalized,
            balanceAdjustment: 0,
            dailyProgressOverride: null,
            streakOverride: null,
            commissionPercentOverride: null,
            updatedAt: new Date().toISOString(),
            updatedBy,
          };
    const next: MemberControlDoc = {
      ...prev,
      ...patch,
      username: normalized,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    if (idx >= 0) items[idx] = next;
    else items.push(next);
    await writeFallback(items);
    return next;
  }

  await db.collection("member_controls").updateOne(
    { username: normalized },
    {
      $set: {
        username: normalized,
        ...patch,
        updatedAt: new Date(),
        updatedBy,
      },
      $setOnInsert: {
        balanceAdjustment: 0,
        dailyProgressOverride: null,
        streakOverride: null,
        commissionPercentOverride: null,
      },
    },
    { upsert: true },
  );

  const row = await db.collection("member_controls").findOne({ username: normalized });
  return {
    username: normalized,
    balanceAdjustment: Number(row?.balanceAdjustment ?? 0),
    dailyProgressOverride:
      row?.dailyProgressOverride == null ? null : Number(row.dailyProgressOverride),
    streakOverride: row?.streakOverride == null ? null : Number(row.streakOverride),
    commissionPercentOverride:
      row?.commissionPercentOverride == null ? null : Number(row.commissionPercentOverride),
    updatedAt: new Date(row?.updatedAt ?? new Date()).toISOString(),
    updatedBy: String(row?.updatedBy ?? updatedBy),
  } as MemberControlDoc;
}
