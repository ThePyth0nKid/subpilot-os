import { NextResponse } from "next/server";
import { z } from "zod";
import { researchMatrix } from "@/lib/agents/geo-research";
import { OPTIMIZABLE_SERVICES } from "@/lib/domain/subscription";
import { getProviders } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

const BodySchema = z.object({
  // Only geo-optimization targets — AI-tool slugs have no country matrix.
  service: z.enum(OPTIMIZABLE_SERVICES),
  countries: z.array(z.string().length(2)).min(1),
});

export async function POST(req: Request) {
  try {
    const { service, countries } = BodySchema.parse(await req.json());
    const { search, llm, proxy } = getProviders();
    const results = await researchMatrix([service], countries, {
      search,
      llm,
      proxy,
    });
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Research failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
