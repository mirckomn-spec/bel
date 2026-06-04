import { getSessionFromCookie } from "@/lib/auth";
import { jsonNoStore } from "@/lib/http";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) {
    return jsonNoStore({ authenticated: false }, { status: 401 });
  }
  return jsonNoStore({
    authenticated: true,
    username: session.username,
    role: session.role,
    redirect: session.role === "admin" ? "/dashboard" : "/painel",
  });
}
