import { z } from "zod";

/**
 * Spend-category of a recurring charge — emitted by the classifier so the
 * insights engine can spot redundancy ("you run 7 image-gen tools"). Distinct
 * from `ServiceSlug` (a specific brand) and `kind` (subscription vs p2p/retail).
 */
export const SpendCategorySchema = z.enum([
  "llm_chat",
  "image_gen",
  "video_gen",
  "audio_gen",
  "dev_tools",
  "hosting",
  "cloud",
  "productivity",
  "community",
  "entertainment",
  "fitness",
  "finance",
  "other",
]);
export type SpendCategory = z.infer<typeof SpendCategorySchema>;

/** Human-readable category labels for the UI. */
export const CATEGORY_LABEL: Readonly<Record<SpendCategory, string>> = {
  llm_chat: "AI chat / LLM",
  image_gen: "AI image",
  video_gen: "AI video",
  audio_gen: "AI audio / music",
  dev_tools: "Dev tools",
  hosting: "Hosting",
  cloud: "Cloud",
  productivity: "Productivity",
  community: "Community",
  entertainment: "Entertainment",
  fitness: "Fitness",
  finance: "Finance",
  other: "Other",
};

/**
 * The kinds of savings opportunity the insights engine detects, all from the
 * statement alone (NO account access, NO credentials — risk-free).
 * - `duplicate`   the same service billed by two parallel active subscriptions
 * - `overlap`     several subscriptions serving one category (consolidate?)
 * - `escalation`  a subscription whose monthly cost is trending UP
 * - `zombie`      long-running, low-touch spend likely forgotten
 */
export const FindingTypeSchema = z.enum([
  "duplicate",
  "overlap",
  "escalation",
  "zombie",
]);
export type FindingType = z.infer<typeof FindingTypeSchema>;

export const FindingSeveritySchema = z.enum(["high", "medium", "low"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingSchema = z
  .object({
    id: z.string(),
    type: FindingTypeSchema,
    severity: FindingSeveritySchema,
    title: z.string(),
    detail: z.string().max(500),
    category: SpendCategorySchema.optional(),
    affectedSubscriptionIds: z.array(z.string()).readonly(),
    /** Best-effort monthly EUR a user could plausibly recover (0 = review-only). */
    estimatedMonthlySavingsEUR: z.number().min(0),
  })
  .readonly();
export type Finding = z.infer<typeof FindingSchema>;
