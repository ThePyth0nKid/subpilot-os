import type { ServiceSlug } from "@/lib/domain/subscription";

export interface CountryInfo {
  readonly name: string;
  readonly currency: string; // ISO-4217 (must exist in FX table)
}

/** Demo country set. Currencies must exist in `lib/domain/fx.ts`. */
export const COUNTRIES: Readonly<Record<string, CountryInfo>> = Object.freeze({
  IN: { name: "India", currency: "INR" },
  TR: { name: "Turkey", currency: "TRY" },
  US: { name: "United States", currency: "USD" },
  DE: { name: "Germany", currency: "EUR" },
  AR: { name: "Argentina", currency: "ARS" },
});

/** Default fan-out matrix for the demo (per user decision). */
export const DEFAULT_COUNTRIES = ["IN", "TR", "US", "DE"] as const;

export function countryInfo(code: string): CountryInfo {
  const info = COUNTRIES[code.toUpperCase()];
  if (!info) throw new Error(`Unknown country "${code}". Known: ${Object.keys(COUNTRIES).join(", ")}.`);
  return info;
}

/**
 * Approximate post-arbitrage monthly price in EUR per service × country.
 * Used ONLY as a fallback when live extraction fails, so the demo never shows
 * an empty result. Note ChatGPT Plus is ~flat globally — not everything is
 * cheaper abroad, which keeps the optimizer honest.
 */
export const FALLBACK_EUR: Readonly<
  Record<Exclude<ServiceSlug, "unknown">, Readonly<Record<string, number>>>
> = Object.freeze({
  netflix: { IN: 2.6, TR: 4.1, US: 16.0, DE: 19.99, AR: 3.2 },
  spotify: { IN: 1.5, TR: 2.3, US: 11.0, DE: 10.99, AR: 1.9 },
  youtube_premium: { IN: 1.4, TR: 2.5, US: 13.99, DE: 12.99, AR: 2.1 },
  disney_plus: { IN: 3.0, TR: 3.6, US: 11.0, DE: 8.99, AR: 3.4 },
  chatgpt: { IN: 20.0, TR: 20.0, US: 18.4, DE: 22.0, AR: 20.0 },
});
