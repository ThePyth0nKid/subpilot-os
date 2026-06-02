import { z } from "zod";

/** Money never uses float arithmetic — store the minor unit (e.g. cents). */
export const MoneySchema = z
  .object({
    amountMinor: z.number().int(), // e.g. cents/paise
    currency: z.string().length(3), // ISO-4217, e.g. "EUR", "INR"
  })
  .readonly();
export type Money = z.infer<typeof MoneySchema>;

/** A price normalized to EUR/month for cross-country comparison. */
export const NormalizedPriceSchema = z
  .object({
    monthlyEUR: z.number(),
    fxRateUsed: z.number(),
    fxAsOf: z.string(), // ISO date
  })
  .readonly();
export type NormalizedPrice = z.infer<typeof NormalizedPriceSchema>;

export const moneyToMajor = (m: Money): number => m.amountMinor / 100;
export const formatMoney = (m: Money): string =>
  `${moneyToMajor(m).toFixed(2)} ${m.currency}`;
