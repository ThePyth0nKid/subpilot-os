import { NextResponse } from "next/server";
import { authEnabled, getUser } from "@/lib/auth";
import { listRuns } from "@/lib/db/repo";

export const runtime = "nodejs";

/** Per-user run history (empty without auth/DB). */
export async function GET() {
  const user = await getUser();
  if (authEnabled() && !user) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  if (!user) return NextResponse.json({ runs: [] });
  const runs = await listRuns(user.id);
  return NextResponse.json({ runs });
}
