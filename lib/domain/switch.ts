import { createHash } from "node:crypto";
import { z } from "zod";
import { ServiceSlugSchema } from "./subscription";
import { PaymentPathSchema } from "./recommendation";
import { AuditEntrySchema, ActionStatusSchema } from "./action";
import { LoginProofResultSchema } from "./login-proof";

/**
 * Stage-2 switch domain. Redaction-by-construction: NO schema here has a field
 * able to hold a raw session token, payment token, or 2FA code — proofs embed
 * an already-redacted `LoginProofResult`, and the reducer state carries only
 * order data + redacted fingerprints. A `z.parse` at any boundary therefore
 * cannot serialize a secret (threat-model C2).
 */

/** The 12 switch states. `cancelling_old` is reachable ONLY after verify-new (C7). */
export const SwitchStateSchema = z.enum([
  "planned",
  "awaiting_consent_provision",
  "provisioning_new",
  "verifying_new",
  "awaiting_consent_cancel",
  "awaiting_2fa",
  "cancelling_old",
  "verifying_cancel",
  "done",
  "rolled_back",
  "rolled_back_with_residual",
  "failed",
]);
export type SwitchState = z.infer<typeof SwitchStateSchema>;

export const TERMINAL_STATES = [
  "done",
  "rolled_back",
  "rolled_back_with_residual",
  "failed",
] as const satisfies readonly SwitchState[];

/** What the driver should DO next given a state. `null` ⇒ terminal. */
export type EffectName =
  | "await_consent_provision"
  | "provision"
  | "verify_new"
  | "await_consent_cancel"
  | "cancel_old"
  | "await_2fa"
  | "verify_cancel";

/** A planned switch, built in code from a viable Recommendation. */
export const SwitchOrderSchema = z
  .object({
    subscriptionId: z.string(),
    service: ServiceSlugSchema,
    fromCountry: z.string().length(2), // ISO-2; always explicit (never "home")
    toCountry: z.string().length(2),
    expectedPlan: z.string(),
    paymentPath: PaymentPathSchema,
    amountMinor: z.number().int().positive(),
    currency: z.string().length(3),
    dryRun: z.boolean(),
  })
  .readonly();
export type SwitchOrder = z.infer<typeof SwitchOrderSchema>;

/** Stable digest of the exact order the user consented to (binds consent, C6). */
export function orderDigest(o: SwitchOrder): string {
  const canonical = JSON.stringify([
    o.subscriptionId,
    o.service,
    o.fromCountry,
    o.toCountry,
    o.expectedPlan,
    o.paymentPath,
    o.amountMinor,
    o.currency,
    o.dryRun,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * Typed events that drive the reducer. The ONLY inputs to the state machine —
 * actions are never derived from LLM free-text or untrusted HTML (C5). `proof`
 * fields carry an already-redacted `LoginProofResult`, never a token.
 */
export const SwitchEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CONSENT_PROVISION_GRANTED"), orderDigest: z.string() }),
  z.object({ type: z.literal("CONSENT_PROVISION_DENIED") }),
  z.object({ type: z.literal("PROVISION_OK"), receiptRef: z.string() }),
  z.object({ type: z.literal("PROVISION_FAILED"), residualAmountMinor: z.number().int().optional() }),
  z.object({ type: z.literal("VERIFY_NEW_OK"), proof: LoginProofResultSchema }),
  z.object({ type: z.literal("VERIFY_NEW_FAILED"), proof: LoginProofResultSchema.optional() }),
  z.object({ type: z.literal("CONSENT_CANCEL_GRANTED"), orderDigest: z.string() }),
  z.object({ type: z.literal("CONSENT_CANCEL_DENIED") }),
  z.object({ type: z.literal("TWOFA_REQUIRED") }),
  z.object({ type: z.literal("TWOFA_SUBMITTED") }),
  z.object({ type: z.literal("TWOFA_EXPIRED") }),
  z.object({ type: z.literal("CANCEL_OK") }),
  z.object({ type: z.literal("CANCEL_FAILED") }),
  z.object({ type: z.literal("VERIFY_CANCEL_OK"), proof: LoginProofResultSchema }),
  z.object({ type: z.literal("VERIFY_CANCEL_FAILED"), proof: LoginProofResultSchema.optional() }),
  z.object({ type: z.literal("ROLLBACK_DONE") }),
  z.object({ type: z.literal("ROLLBACK_RESIDUAL"), residualAmountMinor: z.number().int(), receiptRef: z.string() }),
  z.object({ type: z.literal("ABORT") }),
]);
export type SwitchEvent = z.infer<typeof SwitchEventSchema>;
export type SwitchEventType = SwitchEvent["type"];

/**
 * Pure reducer state. Holds order data + redacted proofs + a type-only event
 * log (for audit + value tests) — never a raw secret.
 */
export interface SwitchMachineState {
  readonly state: SwitchState;
  readonly order: SwitchOrder;
  readonly expectedDigest: string; // orderDigest(order), computed once at init
  readonly consentProvisionDigest?: string;
  readonly consentCancelDigest?: string;
  readonly receiptRef?: string;
  readonly newProof?: z.infer<typeof LoginProofResultSchema>;
  readonly oldProof?: z.infer<typeof LoginProofResultSchema>;
  readonly residualAmountMinor?: number;
  readonly partialState?: string;
  readonly twoFaRequired?: boolean;
  readonly log: readonly SwitchEventType[];
}

export const ConsentInputSchema = z
  .object({
    phase: z.enum(["provision", "cancel"]),
    approved: z.boolean(),
    orderDigest: z.string(),
  })
  .readonly();
export type ConsentInput = z.infer<typeof ConsentInputSchema>;

/** 2FA code: validated at the boundary, handed to the resolver, NEVER stored. */
export const TwoFaInputSchema = z
  .object({ code: z.string().regex(/^[0-9]{4,8}$/) })
  .readonly();
export type TwoFaInput = z.infer<typeof TwoFaInputSchema>;

/**
 * Final result of a switch. `oldSubscriptionCancelled` may be `true` ONLY when
 * an `oldProofAfter` proves it (positive `subscription_cancelled` status) — a
 * refine guard makes an unproven cancellation claim unrepresentable (C7/C8).
 */
export const SwitchResultSchema = z
  .object({
    switchId: z.string(),
    subscriptionId: z.string(),
    state: SwitchStateSchema,
    status: ActionStatusSchema,
    dryRun: z.boolean(),
    giftCardSku: z.string().optional(),
    receiptRef: z.string().optional(),
    newAccountRegion: z.string().optional(),
    oldSubscriptionCancelled: z.boolean(),
    newProofAfter: LoginProofResultSchema.optional(),
    oldProofAfter: LoginProofResultSchema.optional(),
    residualAmountMinor: z.number().int().optional(),
    partialState: z.string().optional(),
    audit: z.array(AuditEntrySchema).readonly(),
    error: z.string().optional(),
  })
  .readonly()
  .refine(
    (r) =>
      !r.oldSubscriptionCancelled ||
      r.oldProofAfter?.status === "subscription_cancelled",
    {
      message:
        "oldSubscriptionCancelled may be true only with an oldProofAfter proving cancellation",
      path: ["oldSubscriptionCancelled"],
    },
  );
export type SwitchResult = z.infer<typeof SwitchResultSchema>;
