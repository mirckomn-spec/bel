import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDbSafe } from "@/lib/mongodb";
import { ALLOWED_USERS } from "@/lib/users";

export type SiteUserDoc = {
  username: string;
  passwordHash: string;
  role: "member";
  blocked: boolean;
  blockedReason: string | null;
  deleted: boolean;
  createdAt: Date;
};

const COLLECTION = "site_users";
const FALLBACK_FILE = path.join(process.cwd(), "storage", "site-users-fallback.json");

async function readFallbackUsers() {
  try {
    const raw = await readFile(FALLBACK_FILE, "utf-8");
    return JSON.parse(raw) as SiteUserDoc[];
  } catch {
    return [];
  }
}

async function writeFallbackUsers(users: SiteUserDoc[]) {
  await mkdir(path.dirname(FALLBACK_FILE), { recursive: true });
  await writeFile(FALLBACK_FILE, JSON.stringify(users, null, 2), "utf-8");
}

export async function findSiteUser(username: string) {
  const { db } = await getDbSafe();
  const normalized = username.toLowerCase();
  if (!db) {
    const users = await readFallbackUsers();
    return users.find((user) => user.username === normalized) ?? null;
  }
  return db.collection(COLLECTION).findOne<SiteUserDoc>({ username: normalized });
}

export function generateRandomPassword() {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function listSiteUsersForAdmin() {
  const { db } = await getDbSafe();
  const rows = db
    ? await db
        .collection(COLLECTION)
        .find({})
        .sort({ username: 1 })
        .toArray()
    : await readFallbackUsers();
  return rows.map((row) => ({
    username: String(row.username ?? ""),
    blocked: Boolean(row.blocked),
    blockedReason: row.blockedReason ? String(row.blockedReason) : null,
    deleted: Boolean(row.deleted),
    createdAt: row.createdAt,
  }));
}

export async function createSiteUser(username: string, plainPassword: string) {
  const { db } = await getDbSafe();
  const normalized = username.toLowerCase().trim();
  if (!normalized || normalized === "bel") {
    throw new Error("Usuario invalido.");
  }
  const passwordHash = await hashPassword(plainPassword);
  if (!db) {
    const users = await readFallbackUsers();
    const existing = users.find((user) => user.username === normalized);
    if (existing && !existing.deleted) {
      throw new Error("Usuario ja existe.");
    }
    const nextUsers = users.filter((user) => user.username !== normalized);
    nextUsers.push({
      username: normalized,
      passwordHash,
      role: "member",
      blocked: false,
      blockedReason: null,
      deleted: false,
      createdAt: existing?.createdAt ?? new Date(),
    });
    await writeFallbackUsers(nextUsers);
    return;
  }
  const existing = await db.collection(COLLECTION).findOne({ username: normalized });
  if (existing && !existing.deleted) {
    throw new Error("Usuario ja existe.");
  }
  await db.collection(COLLECTION).updateOne(
    { username: normalized },
    {
      $set: {
        username: normalized,
        passwordHash,
        role: "member" as const,
        blocked: false,
        blockedReason: null,
        deleted: false,
        createdAt: existing?.createdAt ?? new Date(),
      },
    },
    { upsert: true },
  );
}

export async function setUserBlocked(
  username: string,
  blocked: boolean,
  blockedReason: string | null,
) {
  const { db } = await getDbSafe();
  const normalized = username.toLowerCase().trim();
  if (normalized === "bel") throw new Error("Nao e possivel bloquear a conta da Bel.");
  if (!db) {
    const users = await readFallbackUsers();
    const idx = users.findIndex((user) => user.username === normalized);
    if (idx < 0) {
      const legacyPlain = ALLOWED_USERS[normalized];
      const passwordHash = legacyPlain
        ? await hashPassword(legacyPlain)
        : await hashPassword(generateRandomPassword());
      users.push({
        username: normalized,
        passwordHash,
        role: "member",
        blocked,
        blockedReason: blocked ? (blockedReason?.trim() || "Sem motivo informado.") : null,
        deleted: false,
        createdAt: new Date(),
      });
    } else {
      users[idx] = {
        ...users[idx],
        blocked,
        blockedReason: blocked ? (blockedReason?.trim() || "Sem motivo informado.") : null,
      };
    }
    await writeFallbackUsers(users);
    return;
  }
  const existing = await db.collection(COLLECTION).findOne({ username: normalized });
  if (!existing) {
    const legacyPlain = ALLOWED_USERS[normalized];
    const passwordHash = legacyPlain
      ? await hashPassword(legacyPlain)
      : await hashPassword(generateRandomPassword());
    await db.collection(COLLECTION).insertOne({
      username: normalized,
      passwordHash,
      role: "member" as const,
      blocked,
      blockedReason: blocked ? (blockedReason?.trim() || "Sem motivo informado.") : null,
      deleted: false,
      createdAt: new Date(),
    });
    return;
  }
  await db.collection(COLLECTION).updateOne(
    { username: normalized },
    {
      $set: {
        blocked,
        blockedReason: blocked ? (blockedReason?.trim() || "Sem motivo informado.") : null,
      },
    },
  );
}

export async function setUserDeleted(username: string, hard: boolean) {
  const { db } = await getDbSafe();
  const normalized = username.toLowerCase().trim();
  if (normalized === "bel") throw new Error("Nao e possivel remover a conta da Bel.");
  if (!db) {
    const users = await readFallbackUsers();
    const idx = users.findIndex((user) => user.username === normalized);
    if (hard) {
      if (idx >= 0) {
        users.splice(idx, 1);
        await writeFallbackUsers(users);
      }
      return;
    }
    if (idx < 0) {
      const legacyPlain = ALLOWED_USERS[normalized];
      const passwordHash = legacyPlain
        ? await hashPassword(legacyPlain)
        : await hashPassword(generateRandomPassword());
      users.push({
        username: normalized,
        passwordHash,
        role: "member",
        blocked: true,
        blockedReason: "Conta encerrada.",
        deleted: true,
        createdAt: new Date(),
      });
      await writeFallbackUsers(users);
      return;
    }
    users[idx] = {
      ...users[idx],
      deleted: true,
      blocked: true,
      blockedReason: "Conta encerrada.",
    };
    await writeFallbackUsers(users);
    return;
  }
  if (hard) {
    await db.collection(COLLECTION).deleteOne({ username: normalized });
    return;
  }
  const existing = await db.collection(COLLECTION).findOne({ username: normalized });
  if (!existing) {
    const legacyPlain = ALLOWED_USERS[normalized];
    const passwordHash = legacyPlain
      ? await hashPassword(legacyPlain)
      : await hashPassword(generateRandomPassword());
    await db.collection(COLLECTION).insertOne({
      username: normalized,
      passwordHash,
      role: "member" as const,
      blocked: true,
      blockedReason: "Conta encerrada.",
      deleted: true,
      createdAt: new Date(),
    });
    return;
  }
  await db.collection(COLLECTION).updateOne(
    { username: normalized },
    {
      $set: {
        deleted: true,
        blocked: true,
        blockedReason: "Conta encerrada.",
      },
    },
  );
}
