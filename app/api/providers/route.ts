import { NextResponse } from "next/server";
import { getProviders } from "@/lib/providers";

export const runtime = "nodejs";

/** Surfaces which integrations are running live vs mocked (for the UI chips). */
export async function GET() {
  try {
    const { modes } = getProviders();
    return NextResponse.json({
      modes,
      llm: "anthropic",
      sandbox: "daytona",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider init failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
