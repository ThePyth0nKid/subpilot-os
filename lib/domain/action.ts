import { z } from "zod";

export const ActionStatusSchema = z.enum([
  "dry_run",
  "executed",
  "failed",
  "skipped",
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const AuditEntrySchema = z
  .object({
    at: z.string(),
    step: z.string(),
    detail: z.string(),
  })
  .readonly();
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Output of one Action agent (1 per accepted recommendation). */
export const ActionResultSchema = z
  .object({
    subscriptionId: z.string(),
    status: ActionStatusSchema,
    dryRun: z.boolean(),
    giftCardSku: z.string().optional(),
    receiptRef: z.string().optional(),
    newAccountRegion: z.string().optional(),
    oldSubscriptionCancelled: z.boolean(),
    audit: z.array(AuditEntrySchema).readonly(),
    error: z.string().optional(),
  })
  .readonly();
export type ActionResult = z.infer<typeof ActionResultSchema>;
