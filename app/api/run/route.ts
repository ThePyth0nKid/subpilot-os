import { NextResponse } from "next/server";
import { createRun } from "@/lib/orchestrator/store";
import { runPipeline } from "@/lib/orchestrator/run";

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
    const csv = await readCsv(req);
    if (!csv.trim()) {
      return NextResponse.json({ error: "Empty CSV body" }, { status: 400 });
    }
    const runId = createRun();
    // Fire-and-forget: the pipeline streams its progress over SSE.
    void runPipeline(runId, csv);
    return NextResponse.json({ runId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
