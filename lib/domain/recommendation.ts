import { z } from "zod";
import { GeoPriceResultSchema } from "./geo-price";
import { RiskAssessmentSchema } from "./risk";
import { ServiceSlugSchema } from "./subscription";

export const PaymentPathSchema = z.enum([
  "bitrefill_giftcard",
  "direct_card",
  "none",
]);
export type PaymentPath = z.infer<typeof PaymentPathSchema>;

/** Output of the Optimizer — one per subscription. */
export const RecommendationSchema = z
  .object({
    subscriptionId: z.string(),
    service: ServiceSlugSchema,
    currentMonthlyEUR: z.number(),
    chosen: GeoPriceResultSchema.nullable(), // cheapest viable; null = keep/cancel
    monthlySavingsEUR: z.number(),
    annualSavingsEUR: z.number(),
    paymentPath: PaymentPathSchema,
    tradeoffs: z.array(z.string()).readonly(),
    risk: RiskAssessmentSchema,
    viable: z.boolean(),
    rejectedAlternatives: z.array(GeoPriceResultSchema).readonly(),
  })
  .readonly();
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const OptimizationResultSchema = z
  .object({
    recommendations: z.array(RecommendationSchema).readonly(),
    totalCurrentMonthlyEUR: z.number(),
    totalOptimizedMonthlyEUR: z.number(),
    totalMonthlySavingsEUR: z.number(),
  })
  .readonly();
export type OptimizationResult = z.infer<typeof OptimizationResultSchema>;
