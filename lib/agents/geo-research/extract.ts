import { z } from "zod";
import { EUR_PER_UNIT } from "@/lib/domain/fx";
import type { ServiceSlug } from "@/lib/domain/subscription";
import { MODELS, type LlmClient, type SearchProvider } from "@/lib/providers";
import { countryInfo, FALLBACK_EUR } from "./countries";

export interface ExtractedPrice {
  readonly planName: string;
  readonly monthlyAmountMinor: number; // local currency minor units
  readonly currency: string;
  readonly acceptedPaymentMethods: readonly string[];
  readonly contentNotes: string;
  readonly uiLanguages: readonly string[];
  readonly sourceUrl: string;
  readonly confidence: number;
}

const GeoExtractSchema = z.object({
  planName: z.string(),
  monthlyAmountMinor: z.number().int(),
  acceptedPaymentMethods: z.array(z.string()),
  contentNotes: z.string(),
  uiLanguages: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = `You extract the CURRENT consumer subscription price for a streaming/AI
service in a specific country from web-search context.
Return the standard individual plan's MONTHLY price, expressed in the given
currency's MINOR units (e.g. INR ₹139.00 -> 13900; USD $11.99 -> 1199).
If only an annual price is found, divide by 12. Also note accepted payment
methods, catalogue/language notes (e.g. "no German UI", "local catalogue"), and
UI languages. Set confidence by how directly the context states the price.`;

/** In-country page evidence fetched by the sandbox (best-effort). */
export interface PriceEvidence {
  readonly url: string;
  readonly html: string;
}

/** Crude tag strip so the model spends tokens on text, not markup. */
function htmlToText(html: string, max = 3000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Reject extractions that are wildly off the known regional ballpark
 * (`FALLBACK_EUR`) — e.g. a bad scrape reading ChatGPT·TR as €0.07. Keeps the
 * optimizer honest without trusting a single noisy number.
 */
function isPlausible(
  service: Exclude<ServiceSlug, "unknown">,
  country: string,
  monthlyAmountMinor: number,
  currency: string,
): boolean {
  const ref = FALLBACK_EUR[service][country] ?? FALLBACK_EUR[service].US ?? 10;
  const eurEq = (monthlyAmountMinor / 100) * (EUR_PER_UNIT[currency] ?? 1);
  return eurEq >= ref * 0.3 && eurEq <= ref * 3;
}

/** Kernel-side extraction: in-country evidence + Tavily + Haiku, with a static fallback. */
export async function extractPrice(
  service: Exclude<ServiceSlug, "unknown">,
  country: string,
  deps: { readonly search: SearchProvider; readonly llm: LlmClient },
  evidence?: PriceEvidence,
): Promise<ExtractedPrice> {
  const info = countryInfo(country);
  try {
    const query = `${service.replace("_", " ")} premium subscription price in ${info.name} 2026 per month in ${info.currency}`;
    const res = await deps.search.search(query, { country, maxResults: 5 });
    const context = [
      evidence
        ? `IN-COUNTRY PAGE (${evidence.url}):\n${htmlToText(evidence.html)}`
        : "",
      res.answer ? `WEB ANSWER: ${res.answer}` : "",
      ...res.hits.map((h) => `- ${h.title} (${h.url}): ${h.snippet}`),
    ]
      .filter(Boolean)
      .join("\n");

    const extracted = await deps.llm.extract({
      model: MODELS.haiku,
      system: SYSTEM,
      user: `Service: ${service}\nCountry: ${info.name} (${country})\nCurrency: ${info.currency}\n\nWeb context:\n${context}`,
      schema: GeoExtractSchema,
      toolName: "emit_price",
      maxTokens: 1024,
    });

    if (extracted.monthlyAmountMinor <= 0) throw new Error("non-positive price");
    if (
      !isPlausible(
        service,
        country,
        extracted.monthlyAmountMinor,
        info.currency,
      )
    ) {
      throw new Error("extracted price implausible vs regional reference");
    }

    return {
      ...extracted,
      currency: info.currency,
      sourceUrl: evidence?.url || res.hits[0]?.url || "",
    };
  } catch {
    return fallbackPrice(service, country);
  }
}

function fallbackPrice(
  service: Exclude<ServiceSlug, "unknown">,
  country: string,
): ExtractedPrice {
  const info = countryInfo(country);
  const table = FALLBACK_EUR[service];
  const eur = table[country] ?? table.US ?? 10;
  const rate = EUR_PER_UNIT[info.currency] ?? 1;
  return {
    planName: "Standard (estimate)",
    monthlyAmountMinor: Math.round((eur / rate) * 100),
    currency: info.currency,
    acceptedPaymentMethods: ["gift_card"],
    contentNotes: "Live extraction unavailable — approximate regional estimate.",
    uiLanguages: [info.name === "Germany" ? "de" : "en"],
    sourceUrl: "",
    confidence: 0.25,
  };
}
