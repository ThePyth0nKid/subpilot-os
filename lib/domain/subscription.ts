import { z } from "zod";
import { MoneySchema, NormalizedPriceSchema } from "./money";

/** Services we actively optimize. `unknown` = recurring but not a target. */
export const ServiceSlugSchema = z.enum([
  "netflix",
  "spotify",
  "youtube_premium",
  "disney_plus",
  "chatgpt",
  "unknown",
]);
export type ServiceSlug = z.infer<typeof ServiceSlugSchema>;

/** Services eligible for geo-optimization (excludes `unknown`). */
export const OPTIMIZABLE_SERVICES = [
  "netflix",
  "spotify",
  "youtube_premium",
  "disney_plus",
  "chatgpt",
] as const satisfies readonly ServiceSlug[];

export const BillingIntervalSchema = z.enum([
  "monthly",
  "yearly",
  "quarterly",
  "unknown",
]);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

export const SubscriptionSchema = z
  .object({
    id: z.string(),
    service: ServiceSlugSchema,
    merchantRaw: z.string(),
    merchantNormalized: z.string(),
    currentPrice: MoneySchema,
    interval: BillingIntervalSchema,
    currentMonthly: NormalizedPriceSchema,
    detectedCountry: z.string(), // ISO-3166-1 alpha-2
    currentPlan: z.string().optional(),
    confidence: z.number().min(0).max(1),
    sourceTransactionIds: z.array(z.string()).readonly(),
    /** True when the service is a geo-optimization target. */
    optimizable: z.boolean(),
  })
  .readonly();
export type Subscription = z.infer<typeof SubscriptionSchema>;
