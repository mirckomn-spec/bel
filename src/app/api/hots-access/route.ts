import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSessionFromCookie } from "@/lib/auth";
import { getDbSafe } from "@/lib/mongodb";

type ProfileKey = "loira" | "morena";
type SocialKey = "twitter" | "facebook" | "tiktok" | "instagram" | "discord";

type AccessItem = {
  username: string;
  profileKey: ProfileKey;
  scope: "profile" | "social";
  socialKey?: SocialKey;
  updatedAt: string;
  updatedBy: string;
};

type SocialCredential = {
  login: string;
  password: string;
  url?: string;
};

type ProfileCredentials = {
  profileKey: ProfileKey;
  login: string;
  password: string;
  imageUrl?: string;
  socialCredentialsByKey?: Partial<Record<SocialKey, SocialCredential>>;
  updatedAt: string;
  updatedBy: string;
};

type HotsFallbackState = {
  access: AccessItem[];
  credentialsByProfile: Partial<Record<ProfileKey, ProfileCredentials>>;
};

const FALLBACK_DIR = path.join(process.cwd(), "storage");
const FALLBACK_FILE = path.join(FALLBACK_DIR, "hots-access.json");

function normalizeProfileKey(value: unknown): ProfileKey {
  return String(value ?? "").toLowerCase() === "morena" ? "morena" : "loira";
}

function normalizeSocialKey(value: unknown): SocialKey {
  const v = String(value ?? "").toLowerCase();
  if (v === "twitter" || v === "facebook" || v === "tiktok" || v === "instagram" || v === "discord") {
    return v;
  }
  return "instagram";
}

function normalizeAccessItem(raw: Partial<AccessItem>): AccessItem {
  return {
    username: String(raw.username ?? "").toLowerCase(),
    profileKey: normalizeProfileKey(raw.profileKey),
    scope: raw.scope === "social" ? "social" : "profile",
    socialKey: raw.scope === "social" ? normalizeSocialKey(raw.socialKey) : undefined,
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    updatedBy: String(raw.updatedBy ?? "bel"),
  };
}

async function readFallback() {
  try {
    const raw = await readFile(FALLBACK_FILE, "utf-8");
    const parsed = JSON.parse(raw) as AccessItem[] | HotsFallbackState;
    if (Array.isArray(parsed)) {
      return {
        access: parsed.map((item) => normalizeAccessItem(item)),
        credentialsByProfile: {},
      } as HotsFallbackState;
    }
    return {
      access: Array.isArray(parsed.access) ? parsed.access.map((item) => normalizeAccessItem(item)) : [],
      credentialsByProfile: parsed.credentialsByProfile ?? {},
    } as HotsFallbackState;
  } catch {
    return { access: [], credentialsByProfile: {} } as HotsFallbackState;
  }
}

async function writeFallback(state: HotsFallbackState) {
  await mkdir(FALLBACK_DIR, { recursive: true });
  await writeFile(FALLBACK_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function upsertAccess(items: AccessItem[], next: AccessItem) {
  const filtered = items.filter(
    (item) =>
      !(
        item.username === next.username &&
        item.profileKey === next.profileKey &&
        (item.scope === next.scope) &&
        ((item.scope === "social" ? item.socialKey : "") === (next.scope === "social" ? next.socialKey : ""))
      ),
  );
  filtered.push(next);
  return filtered;
}

function removeAccess(
  items: AccessItem[],
  username: string,
  profileKey: ProfileKey,
  scope: "profile" | "social",
  socialKey?: SocialKey,
) {
  return items.filter(
    (item) =>
      !(
        item.username === username &&
        item.profileKey === profileKey &&
        item.scope === scope &&
        (scope === "social" ? item.socialKey === socialKey : true)
      ),
  );
}

export async function GET(request: Request) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const wantsAll = searchParams.get("all") === "1";

  const fallback = await readFallback();
  const { db } = await getDbSafe();

  let dbItems: AccessItem[] = [];
  let dbCredentialsByProfile: Partial<Record<ProfileKey, ProfileCredentials>> = {};
  if (db) {
    const raw = await db.collection("hots_access").find({}).toArray();
    dbItems = raw.map((item) =>
      normalizeAccessItem({
        username: String(item.username ?? "").toLowerCase(),
        profileKey: normalizeProfileKey(item.profileKey),
        scope: item.scope === "social" ? "social" : "profile",
        socialKey: item.socialKey,
        updatedAt: new Date(item.updatedAt ?? new Date()).toISOString(),
        updatedBy: String(item.updatedBy ?? "bel"),
      }),
    );
    const profileSettings = await db.collection("settings").findOne<{
      key?: string;
      credentialsByProfile?: Partial<Record<ProfileKey, ProfileCredentials>>;
    }>({ key: "hots_profiles" });
    dbCredentialsByProfile = profileSettings?.credentialsByProfile ?? {};
  }

  const mergedMap = new Map<string, AccessItem>();
  for (const item of fallback.access) {
    const key = `${item.username}:${item.profileKey}:${item.scope}:${item.socialKey ?? ""}`;
    mergedMap.set(key, item);
  }
  for (const item of dbItems) {
    const key = `${item.username}:${item.profileKey}:${item.scope}:${item.socialKey ?? ""}`;
    mergedMap.set(key, item);
  }
  const merged = Array.from(mergedMap.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const credentialsByProfile: Partial<Record<ProfileKey, ProfileCredentials>> = {
    ...fallback.credentialsByProfile,
    ...dbCredentialsByProfile,
  };

  if (session.role === "admin" && wantsAll) {
    return NextResponse.json({
      access: merged,
      profilesByKey: credentialsByProfile,
    });
  }

  const myAccessList = merged.filter((item) => item.username === session.username.toLowerCase());
  const profileAccessList = myAccessList.filter((item) => item.scope === "profile");
  const socialAccessList = myAccessList.filter((item) => item.scope === "social");
  return NextResponse.json(
    profileAccessList.map((item) => {
      const profileData = credentialsByProfile[item.profileKey] ?? null;
      const grantedSocials = socialAccessList
        .filter((socialItem) => socialItem.profileKey === item.profileKey)
        .map((socialItem) => socialItem.socialKey)
        .filter((social): social is SocialKey => Boolean(social));
      return {
        ...item,
        credentials: profileData
          ? { login: profileData.login, password: profileData.password }
          : null,
        profileImageUrl: profileData?.imageUrl ?? null,
        grantedSocials,
        socialCredentialsByKey: profileData?.socialCredentialsByKey ?? {},
      };
    }),
  );
}

export async function POST(request: Request) {
  const session = await getSessionFromCookie();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: "release" | "release-social" | "save-credentials";
        username?: string;
        profileKey?: ProfileKey;
        socialKey?: SocialKey;
        login?: string;
        password?: string;
        imageUrl?: string;
        socialLogin?: string;
        socialPassword?: string;
        socialUrl?: string;
      }
    | null;
  const action = body?.action ?? "release";
  const normalizedProfile = normalizeProfileKey(body?.profileKey);
  const fallback = await readFallback();

  if (action === "save-credentials") {
    const login = String(body?.login ?? "").trim();
    const password = String(body?.password ?? "").trim();
    const imageUrl = String(body?.imageUrl ?? "").trim();
    if (!login || !password) {
      return NextResponse.json(
        { error: "Informe login e senha para salvar as credenciais." },
        { status: 400 },
      );
    }

    const credential: ProfileCredentials = {
      profileKey: normalizedProfile,
      login,
      password,
      imageUrl,
      socialCredentialsByKey: {
        ...(fallback.credentialsByProfile[normalizedProfile]?.socialCredentialsByKey ?? {}),
      },
      updatedAt: new Date().toISOString(),
      updatedBy: session.username,
    };
    const socialKey = body?.socialKey ? normalizeSocialKey(body.socialKey) : null;
    const socialLogin = String(body?.socialLogin ?? "").trim();
    const socialPassword = String(body?.socialPassword ?? "").trim();
    const socialUrl = String(body?.socialUrl ?? "").trim();
    if (socialKey && socialLogin && socialPassword) {
      credential.socialCredentialsByKey = {
        ...(credential.socialCredentialsByKey ?? {}),
        [socialKey]: {
          login: socialLogin,
          password: socialPassword,
          url: socialUrl || undefined,
        },
      };
    }
    await writeFallback({
      ...fallback,
      credentialsByProfile: {
        ...fallback.credentialsByProfile,
        [normalizedProfile]: credential,
      },
    });

    const { db } = await getDbSafe();
    if (db) {
      const profileSettings = await db.collection("settings").findOne<{
        credentialsByProfile?: Partial<Record<ProfileKey, ProfileCredentials>>;
      }>({ key: "hots_profiles" });
      const mergedCredentials = {
        ...(profileSettings?.credentialsByProfile ?? {}),
        [normalizedProfile]: credential,
      };
      await db.collection("settings").updateOne(
        { key: "hots_profiles" },
        {
          $set: {
            key: "hots_profiles",
            credentialsByProfile: mergedCredentials,
            updatedAt: new Date(),
            updatedBy: session.username,
          },
        },
        { upsert: true },
      );
    }
    return NextResponse.json({ ok: true });
  }

  const normalizedUsername = String(body?.username ?? "").toLowerCase().trim();
  const normalizedSocial = body?.socialKey ? normalizeSocialKey(body.socialKey) : undefined;

  if (!normalizedUsername || normalizedUsername === "bel") {
    return NextResponse.json({ error: "Usuario invalido." }, { status: 400 });
  }

  const item: AccessItem = {
    username: normalizedUsername,
    profileKey: normalizedProfile,
    scope: action === "release-social" ? "social" : "profile",
    socialKey: action === "release-social" ? normalizedSocial : undefined,
    updatedAt: new Date().toISOString(),
    updatedBy: session.username,
  };

  await writeFallback({
    ...fallback,
    access: upsertAccess(fallback.access, item),
  });

  const { db } = await getDbSafe();
  if (db) {
    await db.collection("hots_access").updateOne(
      { username: normalizedUsername, profileKey: normalizedProfile },
      {
        $set: {
          username: normalizedUsername,
          profileKey: normalizedProfile,
          scope: item.scope,
          socialKey: item.scope === "social" ? item.socialKey : undefined,
          updatedAt: new Date(item.updatedAt),
          updatedBy: session.username,
        },
      },
      { upsert: true },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await getSessionFromCookie();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        username?: string;
        profileKey?: ProfileKey;
        scope?: "profile" | "social";
        socialKey?: SocialKey;
      }
    | null;
  const normalizedUsername = String(body?.username ?? "").toLowerCase().trim();
  const normalizedProfile = normalizeProfileKey(body?.profileKey);
  const normalizedScope = body?.scope === "social" ? "social" : "profile";
  const normalizedSocial = normalizeSocialKey(body?.socialKey);
  if (!normalizedUsername || normalizedUsername === "bel") {
    return NextResponse.json({ error: "Usuario invalido." }, { status: 400 });
  }

  const fallback = await readFallback();
  await writeFallback({
    ...fallback,
    access: removeAccess(
      fallback.access,
      normalizedUsername,
      normalizedProfile,
      normalizedScope,
      normalizedSocial,
    ),
  });

  const { db } = await getDbSafe();
  if (db) {
    await db.collection("hots_access").deleteOne({
      username: normalizedUsername,
      profileKey: normalizedProfile,
      scope: normalizedScope,
      socialKey: normalizedScope === "social" ? normalizedSocial : undefined,
    });
  }
  return NextResponse.json({ ok: true });
}
