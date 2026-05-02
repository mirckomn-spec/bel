import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/auth";
import { uploadFileToDiscordChannel } from "@/lib/discord";
import { getDbSafe } from "@/lib/mongodb";

const UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");
const PROOFS_FALLBACK_FILE = path.join(process.cwd(), "storage", "proofs-fallback.json");

type FallbackProof = {
  id: string;
  uploader: string;
  discordFileUrl: string;
  originalName?: string;
  mimeType?: string;
  productName?: string;
  saleValue?: number;
  grossSaleValue?: number;
};

async function readFallbackProofs() {
  try {
    const raw = await readFile(PROOFS_FALLBACK_FILE, "utf-8");
    return JSON.parse(raw) as FallbackProof[];
  } catch {
    return [];
  }
}

async function writeFallbackProofs(proofs: FallbackProof[]) {
  await mkdir(path.dirname(PROOFS_FALLBACK_FILE), { recursive: true });
  await writeFile(PROOFS_FALLBACK_FILE, JSON.stringify(proofs, null, 2), "utf-8");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { id } = await context.params;
  const { db, error } = await getDbSafe();
  if (!db) {
    const proofs = await readFallbackProofs();
    const proof = proofs.find((item) => item.id === id);
    if (!proof) {
      return NextResponse.json(
        { error: `Comprovante nao encontrado (fallback). Banco indisponivel: ${error}` },
        { status: 404 },
      );
    }
    if (session.role === "member" && proof.uploader.toLowerCase() !== session.username) {
      return NextResponse.json({ error: "Nao autorizado." }, { status: 403 });
    }
    return NextResponse.redirect(proof.discordFileUrl);
  }

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Comprovante invalido." }, { status: 400 });
  }
  const proof = await db
    .collection("proofs")
    .findOne<{
      discordFileUrl?: string;
      storedName?: string;
      mimeType: string;
      originalName: string;
      uploader?: string;
    }>({
      _id: new ObjectId(id),
    });

  if (!proof) {
    return NextResponse.json({ error: "Comprovante nao encontrado." }, { status: 404 });
  }

  if (
    session.role === "member" &&
    String(proof.uploader ?? "").toLowerCase() !== session.username
  ) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 403 });
  }

  if (proof.discordFileUrl) {
    return NextResponse.redirect(proof.discordFileUrl);
  }

  if (proof.storedName) {
    const filePath = path.join(UPLOAD_DIR, proof.storedName);
    const fileStats = await stat(filePath);
    const stream = createReadStream(filePath);

    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": proof.mimeType,
        "Content-Length": fileStats.size.toString(),
        "Content-Disposition": `inline; filename="${proof.originalName}"`,
      },
    });
  }

  return NextResponse.json(
    { error: "Arquivo sem URL do Discord. Reenvie o comprovante." },
    { status: 404 },
  );
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookie();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { id } = await context.params;
  const { db, error } = await getDbSafe();

  if (!db) {
    const proofs = await readFallbackProofs();
    const next = proofs.filter((item) => item.id !== id);
    if (next.length === proofs.length) {
      return NextResponse.json(
        { error: `Comprovante nao encontrado (fallback). Banco indisponivel: ${error}` },
        { status: 404 },
      );
    }
    await writeFallbackProofs(next);
    return NextResponse.json({ ok: true, storage: "fallback" });
  }

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Comprovante invalido." }, { status: 400 });
  }

  const result = await db.collection("proofs").deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Comprovante nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, storage: "mongodb" });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookie();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { id } = await context.params;
  const contentType = request.headers.get("content-type") ?? "";
  let productName: string | null = null;
  let saleValue: number | null = null;
  let replacementFile: File | null = null;
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const pn = String(formData.get("productName") ?? "").trim();
    const sv = Number(String(formData.get("saleValue") ?? ""));
    const f = formData.get("file");
    productName = pn || null;
    saleValue = Number.isFinite(sv) ? sv : null;
    replacementFile = f instanceof File ? f : null;
  } else {
    const body = (await request.json().catch(() => null)) as
      | { productName?: string; saleValue?: number }
      | null;
    const pn = String(body?.productName ?? "").trim();
    const sv = Number(body?.saleValue);
    productName = pn || null;
    saleValue = Number.isFinite(sv) ? sv : null;
  }

  const { db, error } = await getDbSafe();
  if (!db) {
    const proofs = await readFallbackProofs();
    const idx = proofs.findIndex((item) => item.id === id);
    if (idx < 0) {
      return NextResponse.json(
        { error: `Comprovante nao encontrado (fallback). Banco indisponivel: ${error}` },
        { status: 404 },
      );
    }
    const current = proofs[idx];
    let nextUrl = current.discordFileUrl;
    let nextOriginalName = current.originalName;
    let nextMimeType = current.mimeType;
    if (replacementFile) {
      const discordToken = process.env.DISCORD_BOT_TOKEN;
      const discordUploadsChannelId = process.env.DISCORD_UPLOADS_CHANNEL_ID;
      if (!discordToken || !discordUploadsChannelId) {
        return NextResponse.json(
          { error: "Discord nao configurado para substituir arquivo." },
          { status: 503 },
        );
      }
      const arrayBuffer = await replacementFile.arrayBuffer();
      const uploadResult = await uploadFileToDiscordChannel({
        channelId: discordUploadsChannelId,
        token: discordToken,
        fileBuffer: Buffer.from(arrayBuffer),
        fileName: replacementFile.name,
        mimeType: replacementFile.type || "application/octet-stream",
        content: `Comprovante atualizado por ${session.username}`,
      });
      nextUrl = uploadResult.url;
      nextOriginalName = replacementFile.name;
      nextMimeType = replacementFile.type || "application/octet-stream";
    }
    proofs[idx] = {
      ...proofs[idx],
      ...(productName ? { productName } : {}),
      ...(saleValue != null && saleValue >= 0
        ? {
            saleValue: Number(saleValue.toFixed(2)),
            grossSaleValue:
              current.grossSaleValue == null
                ? Number(saleValue.toFixed(2))
                : current.grossSaleValue,
          }
        : {}),
      discordFileUrl: nextUrl,
      originalName: nextOriginalName,
      mimeType: nextMimeType,
    };
    await writeFallbackProofs(proofs);
    return NextResponse.json({ ok: true, storage: "fallback" });
  }

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Comprovante invalido." }, { status: 400 });
  }
  const setDoc: Record<string, unknown> = {};
  if (productName) setDoc.productName = productName;
  if (saleValue != null && saleValue >= 0) setDoc.saleValue = Number(saleValue.toFixed(2));
  if (replacementFile) {
    const discordToken = process.env.DISCORD_BOT_TOKEN;
    const discordUploadsChannelId = process.env.DISCORD_UPLOADS_CHANNEL_ID;
    if (!discordToken || !discordUploadsChannelId) {
      return NextResponse.json(
        { error: "Discord nao configurado para substituir arquivo." },
        { status: 503 },
      );
    }
    const arrayBuffer = await replacementFile.arrayBuffer();
    const uploadResult = await uploadFileToDiscordChannel({
      channelId: discordUploadsChannelId,
      token: discordToken,
      fileBuffer: Buffer.from(arrayBuffer),
      fileName: replacementFile.name,
      mimeType: replacementFile.type || "application/octet-stream",
      content: `Comprovante atualizado por ${session.username}`,
    });
    setDoc.discordFileUrl = uploadResult.url;
    setDoc.originalName = replacementFile.name;
    setDoc.mimeType = replacementFile.type || "application/octet-stream";
  }
  if (Object.keys(setDoc).length === 0) {
    return NextResponse.json({ error: "Nenhuma alteracao enviada." }, { status: 400 });
  }
  const result = await db.collection("proofs").updateOne({ _id: new ObjectId(id) }, { $set: setDoc });
  if (result.matchedCount === 0) {
    return NextResponse.json({ error: "Comprovante nao encontrado." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, storage: "mongodb" });
}
