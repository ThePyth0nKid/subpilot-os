import { parse } from "csv-parse/sync";
import { projectAndRedact, type RedactOptions } from "@/lib/anonymize";
import type { Transaction } from "@/lib/domain/transaction";
import { parseAmountMinor, currencyFromSymbol } from "./amount";
import {
  detectColumns,
  detectDelimiter,
  isMeaningfulReference,
  type ColumnMap,
} from "./csv-schema";
import { parseDateToIso } from "./date";

type Row = Record<string, string>;

/** Signed minor amount from a single amount column, or a debit/credit pair. */
function rowAmountMinor(row: Row, map: ColumnMap): number | null {
  if (map.amount) return parseAmountMinor(row[map.amount]);
  if (map.debit || map.credit) {
    const debit = Math.abs(parseAmountMinor(row[map.debit ?? ""]) ?? 0);
    const credit = Math.abs(parseAmountMinor(row[map.credit ?? ""]) ?? 0);
    if (debit === 0 && credit === 0) return null;
    return credit - debit;
  }
  return null;
}

/** Merchant text: payee + a meaningful reference (skips "N/A" filler). */
function rowMerchant(row: Row, map: ColumnMap): string {
  const payee = (map.merchant ? row[map.merchant] : "") ?? "";
  const ref = map.reference ? row[map.reference] : undefined;
  const text = isMeaningfulReference(ref) ? `${payee} ${ref}` : payee;
  return text.replace(/[\r\n\t]+/g, " ").trim(); // no control chars in an SSE/JSON payload
}

function rowCurrency(row: Row, map: ColumnMap): string {
  const explicit = map.currency ? row[map.currency] : "";
  if (explicit && explicit.trim()) return explicit.trim().toUpperCase().slice(0, 3);
  const fromSymbol = map.amount ? currencyFromSymbol(row[map.amount] ?? "") : null;
  return fromSymbol ?? "EUR";
}

/**
 * Deterministically parse a real bank-statement CSV into Transactions.
 *
 * Schema-agnostic: sniffs the delimiter and maps real-world headers (Finom's
 * German `Buchungsdatum / Auftraggeber-Empfänger / Betrag`, the demo's
 * `date/description/amount/currency`, etc.) onto canonical fields. Each row is
 * PROJECTED to the 4 kept fields and its merchant is REDACTED before becoming a
 * Transaction — so PII or a verbatim source row never enters the pipeline.
 */
export function parseCsv(raw: string, opts?: RedactOptions): readonly Transaction[] {
  const delimiter = detectDelimiter(raw);
  const records = parse(raw, {
    columns: true,
    delimiter,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as Row[];
  if (records.length === 0) return [];

  const map = detectColumns(Object.keys(records[0]));
  // Fail loud on an unrecognized schema rather than silently returning [].
  if (!map.amount && !map.debit && !map.credit) {
    throw new Error(
      "No amount column found — expected one of: Betrag, Amount, Umsatzbetrag, or Soll/Haben.",
    );
  }
  if (!map.date) {
    throw new Error(
      "No date column found — expected one of: Buchungsdatum, Datum, Date.",
    );
  }
  const dateKey = map.date;

  return records
    .map((row, i): Transaction | null => {
      const amountMinor = rowAmountMinor(row, map);
      if (amountMinor === null || !Number.isSafeInteger(amountMinor)) return null;
      const date = parseDateToIso(row[dateKey] ?? "");
      if (!date) return null; // unparseable date → cannot place on the recurrence timeline
      const txn = projectAndRedact(
        { date, merchant: rowMerchant(row, map), amountMinor, currency: rowCurrency(row, map) },
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
