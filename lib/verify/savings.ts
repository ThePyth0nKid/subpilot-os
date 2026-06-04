import type { NormalizedPrice } from "@/lib/domain/money";
import type { VerifyStatus } from "@/lib/domain/login-proof";

export interface Savings {
  readonly savingsEUR: number;
  readonly savingsPct: number; // 0..1
}

/**
 * Monthly EUR saved switching from the user's current price to the target
 * country's price. Clamped to never go negative (a more-expensive country = 0
 * savings, never "negative savings"), pct clamped to 0..1.
 */
export function computeSavings(
  currentMonthlyEUR: number,
  target: NormalizedPrice,
): Savings {
  const saved = currentMonthlyEUR - target.monthlyEUR;
  const savingsEUR = Math.max(0, Math.round(saved * 100) / 100);
  const pct = currentMonthlyEUR > 0 ? savingsEUR / currentMonthlyEUR : 0;
  const savingsPct = Math.min(1, Math.max(0, Math.round(pct * 1000) / 1000));
  return { savingsEUR, savingsPct };
}

/**
 * Verify status from the read outcome (threat-model C8: verified state, not a
 * claim of work done). A mock/datacenter egress can NEVER claim geo, so the best
 * it reports is `verified` (mechanics only); only a real in-country brightdata
 * read earns `verified_live`. No positive auth evidence ⇒ `login_failed`.
 */
export function deriveStatus(
  loggedIn: boolean,
  proxyMode: "mock" | "brightdata",
  inCountry?: boolean,
): VerifyStatus {
  if (!loggedIn) return "login_failed";
  if (proxyMode === "brightdata" && inCountry === true) return "verified_live";
  return "verified";
}
