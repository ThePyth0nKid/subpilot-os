import { z } from "zod";
import { MoneySchema, NormalizedPriceSchema } from "./money";
import { ServiceSlugSchema } from "./subscription";
import { AuditEntrySchema } from "./action";

/**
 * A user-supplied session cookie/token. RUNTIME input only — it is NEVER added
 * to the env schema (`lib/env.ts`) and never persisted. Validated at the API /
 * CLI boundary, handed straight into the ephemeral sandbox, and dropped.
 */
export const SessionTokenSchema = z.string().min(8).max(8192);
export type SessionToken = z.infer<typeof SessionTokenSchema>;

/**
 * Outcome of a Stage-1 read-only login proof.
 * - `verified`      mock proxy: login + read + verify MECHANICS proven; geo NOT
 *                   claimed (datacenter egress), so this never runs a real cookie.
 * - `verified_live` brightdata: real in-country egress proven AND account read.
 * - `login_failed`  reached the account page but no positive auth evidence.
 * - `failed`        sandbox / egress / parse error.
 */
export const VerifyStatusSchema = z.enum([
  "verified",
  "verified_live",
  "login_failed",
  "subscription_cancelled", // Stage 2: positive proof the old plan is cancelled
  "failed",
]);
export type VerifyStatus = z.infer<typeof VerifyStatusSchema>;

/**
 * REDACTED, re-probeable receipt returned by Stage 1. Redaction-by-construction:
 * the schema has NO field able to hold the raw session token or raw account
 * HTML — the only token-derived field is the already-redacted `tokenRedacted`.
 * A `z.parse` at the boundary therefore guarantees no secret can be serialized
 * into an SSE payload, log, or response (threat-model C2). Stage 2 diffs this
 * verified state against the target before any mutation (C8).
 */
export const LoginProofResultSchema = z
  .object({
    service: ServiceSlugSchema,
    status: VerifyStatusSchema,
    loggedIn: z.boolean(),
    currentPlan: z.string(), // "" when not parseable
    billingCountry: z.string(), // ISO-2, or "" when unknown
    targetCountry: z.string(), // ISO-2 we probed for
    inCountry: z.boolean().optional(), // egressCountry === targetCountry (brightdata)
    egressCountry: z.string().optional(),
    proxyMode: z.enum(["mock", "brightdata"]),
    currentMonthlyEUR: z.number().optional(),
    targetPrice: MoneySchema.optional(), // local currency in the target country
    targetMonthly: NormalizedPriceSchema.optional(), // EUR/month
    savingsEUR: z.number(),
    savingsPct: z.number().min(0).max(1),
    sourceUrl: z.string(),
    capturedAt: z.string(), // ISO
    confidence: z.number().min(0).max(1),
    tokenRedacted: z.string(), // the ONLY token-derived field, already redacted
    audit: z.array(AuditEntrySchema).readonly(),
    error: z.string().optional(),
  })
  .readonly();
export type LoginProofResult = z.infer<typeof LoginProofResultSchema>;
