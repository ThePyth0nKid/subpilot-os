import { NextResponse } from "next/server";
import { ingest } from "@/lib/agents/ingest";
import { hasPII } from "@/lib/anonymize";
import { readStatement } from "@/lib/agents/ingest/read-statement";
import { getProviders } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const csv = await readStatement(req); // CSV text or PDF → canonical CSV
    if (!csv.trim()) {
      return NextResponse.json({ error: "Empty statement" }, { status: 400 });
    }
    if (csv.length > 500_000) {
      return NextResponse.json(
        { error: "Statement too large (max 500KB)" },
        { status: 413 },
      );
    }
    const { llm } = getProviders();
    const subscriptions = await ingest(csv, { llm });
    return NextResponse.json({ subscriptions });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Ingest failed";
    const message = hasPII(raw) ? "Ingest failed (invalid input)" : raw;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
