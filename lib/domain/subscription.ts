import { z } from "zod";
import { MoneySchema, NormalizedPriceSchema } from "./money";

/**
 * Known services. The streaming slugs (+chatgpt) are geo-optimization targets;
 * the AI/dev-tool slugs exist so real statements (which are full of them) get
 * labeled correctly instead of being mismapped onto a streaming slug.
 * `unknown` = recurring but not a recognized brand.
 */
export const ServiceSlugSchema = z.enum([
  "netflix",
  "spotify",
  "youtube_premium",
  "disney_plus",
  "chatgpt",
  "claude",
  "cursor",
  "midjourney",
  "suno",
  "elevenlabs",
  "mistral",
  "railway",
  "apple",
  "unknown",
]);
export type ServiceSlug = z.infer<typeof ServiceSlugSchema>;

/**
 * What a recurring charge actually is. Only `subscription` belongs in the
 * savings plan; the rest ("Miriam Mehlis Auszahlung", fuel stations, Amazon
 * shopping that happens to repeat) renders in a separate UI section.
 */
export const SubscriptionKindSchema = z.enum([
  "subscription",
  "p2p",
  "retail",
  "other",
]);
export type SubscriptionKind = z.infer<typeof SubscriptionKindSchema>;

/** Services eligible for geo-optimization (excludes `unknown`). */
export const OPTIMIZABLE_SERVICES = [
  "netflix",
  "spotify",
  "youtube_premium",
  "disney_plus",
  "chatgpt",
] as const satisfies readonly ServiceSlug[];
/** A geo-optimization target — the only slugs geo-research/login-read know. */
export type OptimizableService = (typeof OPTIMIZABLE_SERVICES)[number];

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
    /** Defaults keep pre-v2 DB snapshots parseable. */
    kind: SubscriptionKindSchema.default("subscription"),
    /** Usage-based billing (API spend, metered IDE usage) — amount is a median. */
    variableAmount: z.boolean().default(false),
  })
  .readonly();
export type Subscription = z.infer<typeof SubscriptionSchema>;
