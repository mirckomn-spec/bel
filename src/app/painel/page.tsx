import { redirect } from "next/navigation";
import MembrosPainelClient from "@/components/membros-painel-client";
import { getSessionFromCookie } from "@/lib/auth";
import { getDbSafe } from "@/lib/mongodb";

export default async function PainelPage() {
  const session = await getSessionFromCookie();
  if (!session) redirect("/");
  if (session.role !== "member") redirect("/dashboard");

  const { db } = await getDbSafe();
  const proofs = db
    ? await db
        .collection("proofs")
        .find({ uploader: session.username })
        .sort({ createdAt: -1 })
        .toArray()
    : [];

  const initialProofs = proofs.map((proof) => ({
    id: String(proof._id),
    sellerName: String(proof.sellerName ?? ""),
    productName: String(proof.productName ?? ""),
    uploader: String(proof.uploader ?? ""),
    saleValue: Number(proof.saleValue ?? 0),
    originalName: String(proof.originalName ?? ""),
    mimeType: String(proof.mimeType ?? ""),
    createdAt: new Date(proof.createdAt).toISOString(),
  }));

  return (
    <MembrosPainelClient username={session.username} initialProofs={initialProofs} />
  );
}
