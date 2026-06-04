/**
 * Bank-CSV schema detection: sniff the delimiter and map real-world column
 * headers (English + German, accent-insensitive) onto the canonical fields the
 * ingest pipeline needs. Lets one parser handle Finom, Sparkasse, N26, etc.
 * without per-bank code.
 */

export type CanonicalField =
  | "date"
  | "merchant"
  | "reference"
  | "amount"
  | "currency"
  | "debit"
  | "credit";

export type ColumnMap = Partial<Record<CanonicalField, string>>;

/** Synonyms per field, normalized (lowercased, accent-folded). Longest/most-specific first. */
const SYNONYMS: Record<CanonicalField, readonly string[]> = {
  date: [
    "buchungsdatum", "buchungstag", "valutadatum", "wertstellung", "valuta",
    "booking date", "value date", "transaction date", "posted date", "datum", "date",
  ],
  merchant: [
    "auftraggeber/empfanger", "beguenstigter/zahlungspflichtiger", "auftraggeber",
    "empfanger", "beneficiary", "counterparty", "payee", "merchant", "name",
    "beschreibung", "gegenpartei", "creditor", "description",
  ],
  reference: [
    "verwendungszweck", "buchungstext", "payment reference", "reference",
    "purpose", "details", "memo", "vwz",
  ],
  // "umsatzbetrag" not bare "umsatz" — the latter substring-matches the
  // unrelated "Umsatzart" (transaction-type) column used by Sparkasse/DKB.
  amount: ["umsatzbetrag", "betrag", "amount", "value", "wert"],
  currency: ["wahrung", "currency", "waehrung", "ccy", "curr"],
  debit: ["soll", "belastung", "debit", "auszahlung", "abgang"],
  credit: ["haben", "gutschrift", "credit", "einzahlung", "zugang"],
};

/** Lowercase, fold German accents, collapse whitespace — so "Empfänger" == "empfanger". */
export function foldHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

function matchField(folded: string): CanonicalField | null {
  // Exact match wins over substring; check the more specific fields first.
  const order: readonly CanonicalField[] = [
    "date", "merchant", "reference", "currency", "debit", "credit", "amount",
  ];
  for (const field of order) {
    if (SYNONYMS[field].some((syn) => folded === syn)) return field;
  }
  for (const field of order) {
    if (SYNONYMS[field].some((syn) => folded.includes(syn) || syn.includes(folded)))
      return field;
  }
  return null;
}

/**
 * Map original header strings onto canonical fields. First header to claim a
 * field wins (so a leading "amount" column isn't overridden by a later
 * "amount in account currency"). Returns the ORIGINAL header per field.
 */
export function detectColumns(headers: readonly string[]): ColumnMap {
  const map: ColumnMap = {};
  for (const header of headers) {
    const field = matchField(foldHeader(header));
    if (field && map[field] === undefined) map[field] = header;
  }
  return map;
}

const DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Sniff the delimiter from the first few lines: pick the candidate that splits
 * the header into >= 2 columns AND yields the most CONSISTENT column count
 * across the sampled rows. Sampling the body (not just the header) avoids
 * choosing a delimiter that only appears inside the header. Comma is the
 * tie-break default.
 */
export function detectDelimiter(raw: string): string {
  const lines = raw
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 5);
  if (lines.length === 0) return ",";

  let best = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const headerCols = lines[0].split(d).length;
    if (headerCols < 2) continue; // does not split the header at all
    const consistent = lines.filter((l) => l.split(d).length === headerCols).length;
    const score = consistent * 1000 + headerCols;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** True when a reference field carries real content (not "N/A" filler). */
export function isMeaningfulReference(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "n/a" && v !== "na" && v !== "-" && v !== "none";
}
