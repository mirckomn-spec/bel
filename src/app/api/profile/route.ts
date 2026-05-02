import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSessionFromCookie } from "@/lib/auth";
import { uploadFileToDiscordChannel } from "@/lib/discord";
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

async function writeAvatarMeta(meta: AvatarMeta) {
  await mkdir(path.dirname(AVATAR_FALLBACK_META), { recursive: true });
  await writeFile(AVATAR_FALLBACK_META, JSON.stringify(meta, null, 2), "utf-8");
}

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { db } = await getDbSafe();
  if (!db) {
    const meta = await readAvatarMeta();
    const fallback = meta[session.username];
    return NextResponse.json({
      username: session.username,
      avatarName: fallback ? "stored" : null,
      storage: "fallback",
    });
  }

  const profile = await db.collection("profiles").findOne({
    username: session.username,
  });

  return NextResponse.json({
    username: session.username,
    avatarName: profile?.avatarUrl ? "stored" : null,
  });
}

export async function POST(request: Request) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("avatar");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Selecione uma imagem." }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "A foto de perfil deve ser uma imagem." },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const avatarBuffer = Buffer.from(arrayBuffer);
  const discordToken = process.env.DISCORD_BOT_TOKEN;
  const discordUploadsChannelId = process.env.DISCORD_UPLOADS_CHANNEL_ID;
  if (!discordToken || !discordUploadsChannelId) {
    return NextResponse.json(
      {
        error:
          "Discord nao configurado. Defina DISCORD_BOT_TOKEN e DISCORD_UPLOADS_CHANNEL_ID no .env.local.",
      },
      { status: 503 },
    );
  }

  let discordAvatarUrl = "";
  try {
    const uploadResult = await uploadFileToDiscordChannel({
      channelId: discordUploadsChannelId,
      token: discordToken,
      fileBuffer: avatarBuffer,
      fileName: file.name,
      mimeType: file.type || "image/jpeg",
      content: `Novo avatar enviado por ${session.username}`,
    });
    discordAvatarUrl = uploadResult.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no upload para o Discord.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { db } = await getDbSafe();
  if (!db) {
    const meta = await readAvatarMeta();
    meta[session.username] = {
      avatarUrl: discordAvatarUrl,
    };
    await writeAvatarMeta(meta);

    return NextResponse.json({ ok: true, avatarName: "stored", storage: "fallback" });
  }

  await db.collection("profiles").updateOne(
    { username: session.username },
    {
      $set: {
        username: session.username,
        avatarUrl: discordAvatarUrl,
        avatarMimeType: file.type || "image/jpeg",
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  return NextResponse.json({ ok: true, avatarName: "stored" });
}
