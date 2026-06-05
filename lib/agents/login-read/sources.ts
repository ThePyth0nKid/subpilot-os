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

/** Name + domain of the session cookie to inject for a real browser read. */
export interface SessionCookieSpec {
  readonly name: string;
  readonly domain: string;
}

const COOKIE_SPECS: Readonly<Record<Target, SessionCookieSpec>> = {
  netflix: { name: "NetflixId", domain: ".netflix.com" },
  spotify: { name: "sp_dc", domain: ".spotify.com" },
  youtube_premium: { name: "SAPISID", domain: ".youtube.com" },
  disney_plus: { name: "disney_token", domain: ".disneyplus.com" },
  chatgpt: { name: "__Secure-next-auth.session-token", domain: "chatgpt.com" },
};

export function sessionCookieSpec(service: Target): SessionCookieSpec {
  return COOKIE_SPECS[service];
}
