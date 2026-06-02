import { z } from "zod";
import { MoneySchema } from "./money";

/** A single parsed bank-statement line. */
export const TransactionSchema = z
  .object({
    id: z.string(),
    date: z.string(), // ISO
    amount: MoneySchema,
    counterparty: z.string(), // payee / description
    rawLine: z.string(),
  })
  .readonly();
export type Transaction = z.infer<typeof TransactionSchema>;
