import { z } from "zod";
import { assertNoPII } from "@/lib/anonymize";
import type { LlmClient } from "@/lib/providers";
import { MODELS } from "@/lib/providers";
import {
  BillingIntervalSchema,
  ServiceSlugSchema,
  SubscriptionKindSchema,
} from "@/lib/domain/subscription";
import type { RecurringCandidate } from "./cluster";

const ClassificationSchema = z.object({
  index: z.number().int(),
  merchantNormalized: z.string(),
  service: ServiceSlugSchema,
  kind: SubscriptionKindSchema,
  interval: BillingIntervalSchema,
  currentPlan: z.string().optional(),
  detectedCountry: z.string(), // ISO-3166 alpha-2
  confidence: z.number().min(0).max(1),
});
export type Classification = z.infer<typeof ClassificationSchema>;

const BatchSchema = z.object({
  classifications: z.array(ClassificationSchema),
});

const SYSTEM = `You are the ingest/normalization worker of SubPilot OS.
You receive recurring bank charges already detected as candidates. For EACH candidate:
- merchantNormalized: clean brand name (e.g. "NETFLIX.COM AMSTERDAM" -> "Netflix").
- kind: what this recurring charge actually IS:
  - "subscription": a digital service, SaaS, membership, or usage-billed platform
    (streaming, AI tools, cloud/hosting, gym, software).
  - "p2p": a transfer to a PERSON — a human first+last name as payee, references
    like "Privat", "Auszahlung", "Miete", informal free-text purposes.
  - "retail": repeated shopping/errands — marketplaces (Amazon), supermarkets,
    fuel stations, butchers, restaurants.
  - "other": recurring but none of the above (tax office, insurance, vet, fees).
- service: map known services to their slug:
  netflix, spotify, youtube_premium, disney_plus, chatgpt,
  claude, cursor, midjourney, suno, elevenlabs, mistral, railway, apple.
  IMPORTANT: "CLAUDE.AI" / "ANTHROPIC" is claude — NEVER chatgpt (chatgpt is OpenAI only).
  APPLE.COM/BILL is apple. Everything unrecognized -> "unknown".
- interval: usually "monthly" for these charges.
- currentPlan: best guess from the monthly price (e.g. Netflix 19.99 EUR -> "Premium").
- detectedCountry: the user's billing market. All charges are EUR in Germany -> "DE".
- confidence: 0..1 how sure you are of the service mapping.
Candidates marked variableAmount=true are usage-based spend (API metering, fluctuating
bills) — they are still kind "subscription" when the merchant is a service provider.
Return one classification per candidate, preserving the given index.`;

/**
 * Real statements yield dozens of candidates; one giant call overflows the
 * output budget and truncates the tool JSON (classifications → undefined).
 * Chunking keeps every response comfortably inside maxTokens.
 */
const BATCH_SIZE = 20;

/** Haiku batch classification of recurring candidates → service mapping. */
export async function classifyCandidates(
  candidates: readonly RecurringCandidate[],
  llm: LlmClient,
): Promise<ReadonlyMap<number, Classification>> {
  const out = new Map<number, Classification>();

  for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
    const slice = candidates.slice(start, start + BATCH_SIZE);
    const user = JSON.stringify(
      slice.map((c, i) => ({
        index: start + i, // GLOBAL candidate index — the caller keys on it
        merchantRaw: c.merchantRaw,
        monthlyAmount: `${(c.monthlyAmountMinor / 100).toFixed(2)} ${c.currency}`,
        occurrences: c.occurrences,
        variableAmount: c.variableAmount,
      })),
      null,
      2,
    );

    // Hard invariant: the LLM must NEVER receive PII. Fail closed before the call.
    assertNoPII(user);

    const result = await llm.extract({
      model: MODELS.haiku,
      system: SYSTEM,
      user: `Classify these ${slice.length} recurring charges:\n${user}`,
      schema: BatchSchema,
      toolName: "emit_classifications",
      maxTokens: 4096,
    });

    for (const c of result.classifications) out.set(c.index, c);
  }

  return out;
}
