import { getDbSafe } from "@/lib/mongodb";
import { ALLOWED_USERS } from "@/lib/users";

/**
 * Lista membros para ranking/metas: uniao dos usuarios estaticos legados
 * com usuarios criados no MongoDB, excluindo contas marcadas como deletadas.
 */
export async function listMemberUsernames(): Promise<string[]> {
  const staticMembers = Object.keys(ALLOWED_USERS).filter((u) => u !== "bel");
  const { db } = await getDbSafe();
  if (!db) {
    return staticMembers.sort();
  }

  const [activeRows, deletedRows] = await Promise.all([
    db
      .collection("site_users")
      .find({ role: "member", deleted: { $ne: true } })
      .project({ username: 1 })
      .toArray(),
    db
      .collection("site_users")
      .find({ deleted: true })
      .project({ username: 1 })
      .toArray(),
  ]);

  const deletedSet = new Set(
    deletedRows.map((row) => String(row.username ?? "").toLowerCase()),
  );
  const combined = new Set<string>();
  for (const name of staticMembers) {
    if (!deletedSet.has(name)) combined.add(name);
  }
  for (const row of activeRows) {
    const name = String(row.username ?? "").toLowerCase();
    if (name && name !== "bel" && !deletedSet.has(name)) combined.add(name);
  }
  return Array.from(combined).sort();
}
