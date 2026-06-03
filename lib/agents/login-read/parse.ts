import { COUNTRIES } from "@/lib/agents/geo-research/countries";
import type { ServiceSlug } from "@/lib/domain/subscription";

export type Target = Exclude<ServiceSlug, "unknown">;

export interface AccountFields {
  readonly loggedIn: boolean;
  readonly plan: string; // "" when not found
  readonly billingCountry: string; // ISO-2 or ""
  readonly cancelled: boolean; // Stage 2: positive cancellation marker present
  readonly confidence: number; // 0..1
}

/**
 * Regex SOURCE strings shared by this kernel extractor AND the in-sandbox
 * VERIFY_SCRIPT (interpolated) so the live path and its unit test parse
 * identically. Untrusted account HTML is matched by regex ONLY — it is never
 * fed to an LLM (threat-model C5).
 *
 * `fixture*` match a controllable SubPilot fixture (`data-sp-*` attributes) used
 * by the mechanics proof / fake account host. `auth.<service>` are best-effort
 * positive markers for the future real-page live path. Positive evidence is
 * REQUIRED for `loggedIn`; absence of a login form is NOT trusted on its own (a
 * CDN block page or SPA shell can fake it) — see the adversarial review.
 */
export const PATTERNS = {
  fixturePlan: 'data-sp-plan="([^"]+)"',
  fixtureCountry: 'data-sp-billing-country="([A-Za-z]{2})"',
  fixtureAuth: 'data-sp-auth="true"',
  fixtureCancelled: 'data-sp-cancelled="true"',
  loginWall: 'name="password"|id="password"|>\\s*(?:Sign in|Log in|Anmelden)\\s*<',
  auth: {
    netflix: '"membershipStatus"\\s*:\\s*"CURRENT_MEMBER"|data-uia="account',
    spotify: '"isPremium"\\s*:\\s*true|account-overview',
    youtube_premium: 'paid_memberships|"membershipStatus"',
    disney_plus: '"subscriptionState"|/account/subscription',
    chatgpt: '"plan_type"|/account/manage',
  },
  // Stage 2: per-service POSITIVE cancellation markers (fresh authenticated read).
  cancelled: {
    netflix: 'your last day|membership will end|restart your membership',
    spotify: 'your premium ends|reactivate premium|plan: spotify free',
    youtube_premium: 'membership ends|restart your membership|no longer a member|benefits end',
    disney_plus: 'subscription ends|restart your subscription|cancelled',
    chatgpt: 'cancel at period end|your plan will be cancell?ed|renews: never',
  },
} as const satisfies {
  fixturePlan: string;
  fixtureCountry: string;
  fixtureAuth: string;
  fixtureCancelled: string;
  loginWall: string;
  auth: Record<Target, string>;
  cancelled: Record<Target, string>;
};

function firstMatch(html: string, pattern: string): string {
  const m = new RegExp(pattern, "i").exec(html);
  return m ? (m[1] ?? m[0]) : "";
}

/**
 * Canonical pure extraction over untrusted account HTML. The in-sandbox
 * VERIFY_SCRIPT mirrors this exact algorithm with the SAME `PATTERNS`, so the
 * live path and this unit-tested function agree. Returns small typed fields
 * only — never the raw HTML.
 */
export function extractAccountFields(
  service: Target,
  html: string,
): AccountFields {
  const plan = firstMatch(html, PATTERNS.fixturePlan);
  const countryRaw = firstMatch(html, PATTERNS.fixtureCountry);
  const hasFixtureAuth = new RegExp(PATTERNS.fixtureAuth, "i").test(html);
  const hasServiceAuth = new RegExp(PATTERNS.auth[service], "i").test(html);
  const hasLoginWall = new RegExp(PATTERNS.loginWall, "i").test(html);

  const billingCountry = normalizeCountry(countryRaw);
  // Positive auth evidence AND a parsed plan; a login wall hard-disqualifies.
  const loggedIn = (hasFixtureAuth || hasServiceAuth) && !hasLoginWall && plan.length > 0;
  // Cancellation requires a positive marker from a still-authenticated read.
  const cancelled =
    loggedIn &&
    (new RegExp(PATTERNS.fixtureCancelled, "i").test(html) ||
      new RegExp(PATTERNS.cancelled[service], "i").test(html));
  const confidence = loggedIn ? (hasFixtureAuth ? 0.9 : 0.6) : 0.1;
  return { loggedIn, plan, billingCountry, cancelled, confidence };
}

const NAME_TO_ISO: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(COUNTRIES).map(([cc, info]) => [info.name.toLowerCase(), cc]),
);

/** Normalize a display name / locale / ISO-2 to an uppercase ISO-2 code (or ""). */
export function normalizeCountry(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const locale = /[-_]([A-Za-z]{2})$/.exec(s);
  if (locale) return locale[1].toUpperCase();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return NAME_TO_ISO[s.toLowerCase()] ?? "";
}
