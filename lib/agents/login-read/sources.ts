import type { Target } from "./parse";

export { pricingUrl } from "@/lib/agents/geo-research/sources";

/**
 * Read-only account / membership pages per service. Stage 1 only ever GETs
 * these (no settings mutation). Login-walled — the proof is that a supplied
 * session cookie reaches the authenticated view.
 */
const ACCOUNT_URLS: Readonly<Record<Target, string>> = {
  netflix: "https://www.netflix.com/account",
  spotify: "https://www.spotify.com/account/overview/",
  youtube_premium: "https://www.youtube.com/paid_memberships",
  disney_plus: "https://www.disneyplus.com/account/subscription",
  chatgpt: "https://chatgpt.com/#settings/Account",
};

export function accountPageUrl(service: Target): string {
  return ACCOUNT_URLS[service];
}
