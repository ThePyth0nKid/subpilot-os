import type { Money, NormalizedPrice } from "./money";
import type { BillingInterval } from "./subscription";

/**
 * Static EUR FX table for the demo (1 unit of currency = N EUR).
 * Approximate 2026 rates — good enough for a comparison demo; a real build
 * would pull live rates. India/Turkey/Argentina rates drive the arbitrage.
 */
export const FX_AS_OF = "2026-05-01";

export const EUR_PER_UNIT: Readonly<Record<string, number>> = Object.freeze({
  EUR: 1,
  USD: 0.92,
  INR: 0.011,
  TRY: 0.028,
  ARS: 0.001,
});

/** How many of `interval` fit in a month (to normalize to monthly). */
const MONTHS_PER_INTERVAL: Readonly<Record<BillingInterval, number>> =
  Object.freeze({
    monthly: 1,
    quarterly: 3,
    yearly: 12,
    unknown: 1,
  });

/** Convert a local-currency Money at a billing interval into EUR/month. */
export function toMonthlyEUR(
  price: Money,
  interval: BillingInterval,
): NormalizedPrice {
  const rate = EUR_PER_UNIT[price.currency];
  if (rate === undefined) {
    throw new Error(
      `No FX rate for currency "${price.currency}". Known: ${Object.keys(EUR_PER_UNIT).join(", ")}.`,
    );
  }
  const major = price.amountMinor / 100;
  const months = MONTHS_PER_INTERVAL[interval];
  const monthlyEUR = (major * rate) / months;
  return {
    monthlyEUR: Math.round(monthlyEUR * 100) / 100,
    fxRateUsed: rate,
    fxAsOf: FX_AS_OF,
  };
}
