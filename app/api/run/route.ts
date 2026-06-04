import { NextResponse } from "next/server";
import { createRun } from "@/lib/orchestrator/store";
import { runPipeline } from "@/lib/orchestrator/run";
import { authEnabled, getUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/ratelimit";
import { hasPII } from "@/lib/anonymize";
import { readStatement } from "@/lib/agents/ingest/read-statement";
import { upsertUser } from "@/lib/db/repo";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const user = await getUser();
    if (authEnabled() && !user) {
      return NextResponse.json({ error: "Sign in to run an optimization" }, { status: 401 });
    }
    // Cap the expensive Daytona + LLM + Tavily fan-out per caller before it starts.
    const limited = enforceRateLimit(req, "run", user);
    if (limited) return limited;
    const csv = await readStatement(req); // CSV text or PDF → canonical CSV
    if (!csv.trim()) {
      return NextResponse.json({ error: "Empty statement" }, { status: 400 });
    }
    if (csv.length > 500_000) {
      return NextResponse.json(
        { error: "CSV too large (max 500KB)" },
        { status: 413 },
      );
    }
    if (user) await upsertUser(user.id, user.email).catch(() => {});
    const runId = createRun(user?.id);
    // Fire-and-forget: the pipeline streams its progress over SSE.
    void runPipeline(runId, csv, user?.id);
    return NextResponse.json({ runId });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Failed to start run";
    const message = hasPII(raw) ? "Failed to start run (invalid input)" : raw;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
