import { z } from "zod";
import { RiskToleranceSchema } from "./preference";

export const RiskAssessmentSchema = z
  .object({
    level: RiskToleranceSchema, // low | medium | high
    tosViolationLikelihood: z.number().min(0).max(1),
    accountBanRisk: z.number().min(0).max(1),
    reasons: z.array(z.string()).readonly(),
    mitigations: z.array(z.string()).readonly(),
  })
  .readonly();
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
