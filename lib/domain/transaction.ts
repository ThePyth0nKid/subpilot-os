import { z } from "zod";
import { MoneySchema } from "./money";

/**
 * A single parsed bank-statement line, AFTER anonymization. `counterparty` is
 * the REDACTED merchant/description only. The verbatim source-row copy
 * (`rawLine`) is intentionally absent — projection drops every other column so
 * raw PII is structurally eliminated, not merely cleaned.
 */
export const TransactionSchema = z
  .object({
    id: z.string(),
    date: z.string(), // ISO
    amount: MoneySchema,
    counterparty: z.string(), // redacted payee / description
  })
  .readonly();
export type Transaction = z.infer<typeof TransactionSchema>;
