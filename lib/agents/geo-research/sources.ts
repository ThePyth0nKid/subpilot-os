import type { ServiceSlug } from "@/lib/domain/subscription";

type Target = Exclude<ServiceSlug, "unknown">;

/**
 * Best-effort official pricing/help URL per service × country. Fetched from
 * INSIDE the geo sandbox (via the country proxy) as in-country evidence for the
 * extractor. SPA shells / 404s are fine — Tavily remains the reliable fallback,
 * and the geo.brdtest.com egress check is the hard proof of in-country routing.
 */
const BUILDERS: Readonly<Record<Target, (cc: string) => string>> = {
  netflix: () => "https://help.netflix.com/en/node/24926",
  spotify: (cc) => `https://www.spotify.com/${cc.toLowerCase()}/premium/`,
  youtube_premium: () => "https://www.youtube.com/premium",
  disney_plus: (cc) => `https://www.disneyplus.com/${cc.toLowerCase()}/`,
  chatgpt: () => "https://openai.com/chatgpt/pricing/",
};

export function pricingUrl(service: Target, country: string): string {
  return BUILDERS[service](country);
}
