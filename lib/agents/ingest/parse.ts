import { parse } from "csv-parse/sync";
import { projectAndRedact, type RedactOptions } from "@/lib/anonymize";
import type { Transaction } from "@/lib/domain/transaction";

interface RawRow {
  readonly date?: string;
  readonly description?: string;
  readonly amount?: string;
  readonly currency?: string;
}

/**
 * Deterministically parse a bank-statement CSV into Transactions. Each row is
 * PROJECTED to the 4 fields we keep and its description is REDACTED before it
 * becomes a Transaction — so a Transaction never carries PII or a verbatim
 * source-row copy. `opts.holderNames` adds optional account-holder redaction.
 */
export function parseCsv(raw: string, opts?: RedactOptions): readonly Transaction[] {
  const rows = parse(raw, {
    // Normalize header case so real exports ("Date,Description,…") map correctly
    // instead of silently parsing to zero transactions.
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as RawRow[];

  return rows
    .map((row, i): Transaction | null => {
      const amountStr = (row.amount ?? "").replace(/[^0-9.\-]/g, "");
      const value = Number.parseFloat(amountStr);
      if (!Number.isFinite(value)) return null;
      const currency = (row.currency ?? "EUR").toUpperCase().slice(0, 3);
      // Project to the 4 kept fields + redact the free-text merchant in one step.
      const txn = projectAndRedact(
        {
          date: row.date ?? "",
          merchant: row.description ?? "",
          amountMinor: Math.round(value * 100),
          currency,
        },
        opts,
      );
      return {
        id: `tx-${i}`,
        date: txn.date,
        amount: { amountMinor: txn.amountMinor, currency: txn.currency },
        counterparty: txn.merchant,
      };
    })
    .filter((t): t is Transaction => t !== null);
}
