import { z } from "zod";

export const UsageFrequencySchema = z.enum(["daily", "weekly", "rarely", "never"]);
export type UsageFrequency = z.infer<typeof UsageFrequencySchema>;

export const KeepDecisionSchema = z.enum([
  "must_keep",
  "nice_to_have",
  "cancel_candidate",
]);
export type KeepDecision = z.infer<typeof KeepDecisionSchema>;

export const RiskToleranceSchema = z.enum(["low", "medium", "high"]);
export type RiskTolerance = z.infer<typeof RiskToleranceSchema>;

/** Output of the Interview agent — one per subscription. */
export const PreferenceProfileSchema = z
  .object({
    subscriptionId: z.string(),
    usage: UsageFrequencySchema,
    householdSize: z.number().int().min(1),
    needs4K: z.boolean(),
    englishOnlyOk: z.boolean(),
    localContentImportant: z.boolean(),
    keep: KeepDecisionSchema,
    maxRisk: RiskToleranceSchema,
  })
  .readonly();
export type PreferenceProfile = z.infer<typeof PreferenceProfileSchema>;

export const QuestionSchema = z
  .object({
    id: z.string(),
    subscriptionId: z.string(),
    text: z.string(),
    kind: z.enum(["single", "yesno", "scale"]),
    options: z.array(z.string()).readonly().optional(),
    rationale: z.string(), // why this question changes the recommendation
  })
  .readonly();
export type Question = z.infer<typeof QuestionSchema>;

export const AnswerSchema = z
  .object({ questionId: z.string(), value: z.string() })
  .readonly();
export type Answer = z.infer<typeof AnswerSchema>;
