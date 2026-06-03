import { z } from "zod";

/**
 * RawTxn — the projected 4-field view of a bank-statement row. PROJECTION is
 * the primary privacy defense: every other column (IBAN, holder name, balance,
 * mandate ref, BIC, address) is dropped here and never enters the pipeline.
 * `merchant` is the only free-text field, and is the single thing the redaction
 * pipeline cleans before it becomes a domain `Transaction.counterparty`.
 *
 * A RawTxn straight out of {@link projectRow} may STILL carry PII inside
 * `merchant`; only the output of `redactRawTxn` is safe to surface.
 */
export const RawTxnSchema = z
  .object({
    date: z.string(), // ISO-ish; no PII, used for recurrence
    merchant: z.string(), // free-text description / Verwendungszweck — REDACTED downstream
    amountMinor: z.number().int(), // signed minor units; no PII
    currency: z.string().length(3), // ISO-4217; no PII
  })
  .readonly();
export type RawTxn = z.infer<typeof RawTxnSchema>;

/**
 * Project an arbitrary parsed row down to the 4 fields we keep. Any extra keys
 * (the PII-bearing columns) are structurally discarded — they are never read.
 */
export function projectRow(input: {
  readonly date: string;
  readonly merchant: string;
  readonly amountMinor: number;
  readonly currency: string;
}): RawTxn {
  return RawTxnSchema.parse({
    date: input.date,
    merchant: input.merchant,
    amountMinor: input.amountMinor,
    currency: input.currency,
  });
}
