import { z } from "zod";
import type { LlmClient } from "@/lib/providers";
import { MODELS } from "@/lib/providers";
import { BillingIntervalSchema, ServiceSlugSchema } from "@/lib/domain/subscription";
import type { RecurringCandidate } from "./cluster";

const ClassificationSchema = z.object({
  index: z.number().int(),
  merchantNormalized: z.string(),
  service: ServiceSlugSchema,
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
- service: map ONLY streaming/AI subscriptions to a slug:
  netflix, spotify, youtube_premium, disney_plus, chatgpt.
  Everything else (gym, mobile, insurance, utilities, rent, cloud storage like iCloud,
  Amazon Prime, etc.) -> "unknown".
- interval: usually "monthly" for these charges.
- currentPlan: best guess from the monthly price (e.g. Netflix 19.99 EUR -> "Premium").
- detectedCountry: the user's billing market. All charges are EUR in Germany -> "DE".
- confidence: 0..1 how sure you are of the service mapping.
Return one classification per candidate, preserving the given index.`;

/** Haiku batch classification of recurring candidates → service mapping. */
export async function classifyCandidates(
  candidates: readonly RecurringCandidate[],
  llm: LlmClient,
): Promise<ReadonlyMap<number, Classification>> {
  if (candidates.length === 0) return new Map();

  const user = JSON.stringify(
    candidates.map((c, index) => ({
      index,
      merchantRaw: c.merchantRaw,
      monthlyAmount: `${(c.monthlyAmountMinor / 100).toFixed(2)} ${c.currency}`,
      occurrences: c.occurrences,
    })),
    null,
    2,
  );

  const result = await llm.extract({
    model: MODELS.haiku,
    system: SYSTEM,
    user: `Classify these ${candidates.length} recurring charges:\n${user}`,
    schema: BatchSchema,
    toolName: "emit_classifications",
    maxTokens: 2048,
  });

  return new Map(result.classifications.map((c) => [c.index, c]));
}
