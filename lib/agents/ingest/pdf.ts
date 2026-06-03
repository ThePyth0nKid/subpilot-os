import { extractText, getDocumentProxy } from "unpdf";
import { redactMerchant, type RedactOptions } from "@/lib/anonymize";
import { parseAmountMinor } from "./amount";
import { parseDateToIso } from "./date";

/** A transaction extracted from a PDF statement (merchant already redacted). */
export interface PdfRow {
  readonly date: string; // ISO
  readonly merchant: string; // structurally redacted
  readonly amountMinor: number;
  readonly currency: string;
}

/** Extract the full text of a (text-based) PDF statement. */
export async function extractStatementText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const DATE_RE = /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g;
// "1 EUR = 1,1614 USD" foreign-exchange note inside the description.
const FX_RE = /\b1\s+[A-Za-z]{3}\s*=\s*[\d.,]+\s+[A-Za-z]{3}\b/g;
// The first EUR amount in a row is the booked amount (the later one is the
// balance). STRICT German grouping (\d{1,3} then exact .ddd groups, comma
// decimals — the format Finom always emits): a preceding token's trailing
// digits can then never merge into the amount, whether space-separated
// ("BIC …66 2.380,00") or dot-attached ("…66.2.380,00").
const EUR_AMOUNT_RE = /(-?)\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*€/;

/**
 * Parse the flattened text of a Finom-style PDF statement into transactions.
 *
 * The PDF flattens to one stream: `DATE  merchant [FX]  -amount €  [-usd $]  balance €`.
 * We chunk on date anchors, take the FIRST EUR value as the booked amount (the
 * USD equivalent uses `$`, the running balance is the later `€`), and redact
 * the merchant structurally so PII (IBANs in transfer lines) never leaves here.
 * The account-header block (Ausstellungsdatum / Eröffnungssaldo €) is skipped by
 * starting at the first transaction-table header.
 *
 * FORMAT ASSUMPTION (Finom-specific, enforced by EUR_AMOUNT_RE): amounts are
 * always German comma-decimal with dot-grouped thousands and two decimals
 * ("3.500,00 €" — never "100 €" or "1234,56 €"). Other banks' PDFs would need
 * their own amount pattern before this parser can be trusted with them.
 */
export function parseStatementText(text: string, opts?: RedactOptions): readonly PdfRow[] {
  const headerIdx = text.search(/Einnahmen\s*\/\s*Ausgaben/);
  const body = headerIdx >= 0 ? text.slice(headerIdx) : text;

  const anchors = [...body.matchAll(DATE_RE)];
  const rows: PdfRow[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const start = a.index ?? 0;
    const end = i + 1 < anchors.length ? (anchors[i + 1].index ?? body.length) : body.length;
    const iso = parseDateToIso(a[0]);
    if (!iso) continue;

    const afterDate = body.slice(start + a[0].length, end);
    const amt = afterDate.match(EUR_AMOUNT_RE);
    if (!amt || amt.index === undefined) continue; // no EUR amount → header/footer line
    const amountMinor = parseAmountMinor(`${amt[1]}${amt[2]}`);
    if (amountMinor === null || amountMinor === 0 || !Number.isSafeInteger(amountMinor)) continue;

    const merchant = redactMerchant(
      afterDate.slice(0, amt.index).replace(FX_RE, " ").replace(/\s+/g, " ").trim(),
      opts,
    );
    rows.push({ date: iso, merchant, amountMinor, currency: "EUR" });
  }
  return rows;
}

/** One CSV field, quoted only when it must be. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serialize flattened statement TEXT to the canonical CSV the ingest pipeline
 * already parses (`date,description,amount,currency`). Pure + testable without a
 * PDF binary. Merchants are redacted in {@link parseStatementText}, so raw PII
 * never reaches the serialized output, logs, or the LLM.
 */
export function statementTextToCsv(text: string, opts?: RedactOptions): string {
  const rows = parseStatementText(text, opts);
  const lines = ["date,description,amount,currency"];
  for (const r of rows) {
    lines.push(
      `${r.date},${csvField(r.merchant)},${(r.amountMinor / 100).toFixed(2)},${r.currency}`,
    );
  }
  return lines.join("\n");
}

/**
 * Extract a PDF statement to canonical CSV. Re-parsing in the pipeline
 * re-applies the (idempotent) anonymization boundary. Fails loud on an
 * image-only (scanned) PDF instead of silently yielding an empty run.
 */
export async function pdfStatementToCsv(
  bytes: Uint8Array,
  opts?: RedactOptions,
): Promise<string> {
  const text = await extractStatementText(bytes);
  if (!text.trim()) {
    throw new Error(
      "No text could be extracted from the PDF — it may be a scanned image. Export a text-based statement or a CSV instead.",
    );
  }
  return statementTextToCsv(text, opts);
}
