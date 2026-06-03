import { NextResponse } from "next/server";
import { createRun } from "@/lib/orchestrator/store";
import { runPipeline } from "@/lib/orchestrator/run";
import { authEnabled, getUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/ratelimit";
import { upsertUser } from "@/lib/db/repo";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Read CSV from multipart `file`, JSON `{ csv }`, or a raw text body. */
async function readCsv(req: Request): Promise<string> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (file instanceof File) return await file.text();
    const csv = form.get("csv");
    if (typeof csv === "string") return csv;
    throw new Error("multipart body missing `file` or `csv` field");
  }
  const text = await req.text();
  if (ct.includes("application/json") || text.trimStart().startsWith("{")) {
    const body = JSON.parse(text) as { csv?: string };
    if (!body.csv) throw new Error("JSON body missing `csv` field");
    return body.csv;
  }
  return text;
}

export async function POST(req: Request) {
  try {
    const user = await getUser();
    if (authEnabled() && !user) {
      return NextResponse.json({ error: "Sign in to run an optimization" }, { status: 401 });
    }
    // Cap the expensive Daytona + LLM + Tavily fan-out per caller before it starts.
    const limited = enforceRateLimit(req, "run", user);
    if (limited) return limited;
    const csv = await readCsv(req);
    if (!csv.trim()) {
      return NextResponse.json({ error: "Empty CSV body" }, { status: 400 });
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
    const message = err instanceof Error ? err.message : "Failed to start run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
