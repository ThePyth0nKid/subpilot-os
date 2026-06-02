import { parse } from "csv-parse/sync";
import type { Transaction } from "@/lib/domain/transaction";

interface RawRow {
  readonly date?: string;
  readonly description?: string;
  readonly amount?: string;
  readonly currency?: string;
}

/** Deterministically parse a bank-statement CSV into Transactions. */
export function parseCsv(raw: string): readonly Transaction[] {
  const rows = parse(raw, {
    columns: true,
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
      return {
        id: `tx-${i}`,
        date: row.date ?? "",
        amount: { amountMinor: Math.round(value * 100), currency },
        counterparty: row.description ?? "",
        rawLine: `${row.date ?? ""},${row.description ?? ""},${row.amount ?? ""},${row.currency ?? ""}`,
      };
    })
    .filter((t): t is Transaction => t !== null);
}
