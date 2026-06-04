import { parseStatementText, statementTextToCsv } from "@/lib/agents/ingest/pdf";
import { parseCsv } from "@/lib/agents/ingest/parse";
import { clusterRecurring } from "@/lib/agents/ingest/cluster";
import { hasPII } from "@/lib/anonymize";

/**
 * PURE, zero-env gate for PR-M3 (PDF statement ingestion). Tests the flattened-
 * text parser on a SYNTHETIC Finom-PDF-text string (the unpdf binary extraction
 * is verified separately against a real PDF). Proves: header block skipped, FX
 * stripped, the FIRST EUR value taken as the amount (not the USD/balance), the
 * BIC-trailing-digit merge bug stays fixed, IBANs redacted, and the result
 * flows through the pipeline into recurring subscriptions.
 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-pdf-parse] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-pdf-parse] ok: ${msg}`);
}
const has = (h: string, n: string) => h.includes(n);

// Mimics how unpdf flattens a Finom statement: account header (must be skipped),
// the table header, then rows "DATE merchant [FX] - amt € [- usd $] balance €".
const TEXT = [
  "Max Mustermann KONTOAUSZUG Musterstr. 1 Ausstellungsdatum: 03.06.2026",
  "Von: 01.03.2026 Bis: 03.06.2026 Eröffnungssaldo: 0,00 € Abschlusssaldo: 1.234,56 €",
  "IBAN: DE68 1001 8000 0880 2639 31 BIC: FNOMDEB2",
  "Vervollständigt Beschreibung Einnahmen / Ausgaben Guthaben",
  "15.05.2026 NETFLIX.COM - 12,99 € 1.234,56 €",
  "15.05.2026 BRIGHT DATA NETWORKS 1 EUR = 1,1614 USD - 17,22 € - 20,00 $ 1.247,55 €",
  "10.05.2026 H AND D FORUM RE-2026 05 1029 IBAN: DE59666500850000753505 BIC: PZHSDE66 2.380,00 € 1.264,77 €",
  "05.05.2026 Erika Musterfrau Privat IBAN: DE23110101002117867767 BIC: SOBKDEBBXXX - 300,00 € 3.644,77 €",
  "1Mit Finom.co erstellt Vervollständigt Beschreibung Einnahmen / Ausgaben Guthaben",
  "15.04.2026 NETFLIX.COM - 12,99 € 3.944,77 €",
  "30.04.2026 Gehalt Arbeitgeber 3.500,00 € 3.957,76 €",
  "15.03.2026 NETFLIX.COM - 12,99 € 457,76 €",
].join(" ");

const rows = parseStatementText(TEXT);

// ── 1. Header block skipped; only the 7 transaction rows parsed ──
assert(rows.length === 7, "1: 7 transactions parsed (account-header dates skipped)");
assert(!rows.some((r) => Math.abs(r.amountMinor) === 0), "1: no zero-amount rows");

// ── 2. First EUR value = booked amount (not USD, not balance); FX stripped ──
{
  const bright = rows.find((r) => has(r.merchant, "BRIGHT DATA"));
  assert(bright?.amountMinor === -1722, "2: amount is the first EUR (-17,22), not USD/balance");
  assert(!!bright && !has(bright.merchant, "USD") && !has(bright.merchant, "1614"), "2: FX note stripped from merchant");
  const netflix = rows.find((r) => has(r.merchant, "NETFLIX"));
  assert(netflix?.amountMinor === -1299 && netflix.currency === "EUR", "2: Netflix -12,99 EUR");
}

// ── 3. BIC trailing digits do NOT merge into the amount (was €662,380) ──
{
  const hd = rows.find((r) => has(r.merchant, "AND D FORUM"));
  assert(hd?.amountMinor === 238000, "3: H&D amount is 2.380,00 €, not 66 2.380,00 (BIC-merge fixed)");
}

// ── 4. IBANs in transfer lines are redacted; no PII survives ──
{
  const transfer = rows.find((r) => has(r.merchant, "Erika"));
  assert(!!transfer && has(transfer.merchant, "[IBAN]"), "4: transfer IBAN → [IBAN]");
  assert(!rows.some((r) => r.merchant.replace(/\s/g, "").includes("DE23110101002117867767")), "4: raw transfer IBAN gone");
  assert(rows.filter((r) => hasPII(r.merchant)).length === 0, "4: authoritative hasPII guard finds 0 leaks");
}

// ── 5. Through the pipeline → Netflix recurring; income excluded ──
{
  const csv = statementTextToCsv(TEXT);
  const txs = parseCsv(csv);
  assert(txs.length === 7, "5: 7 transactions survive CSV round-trip");
  const cands = clusterRecurring(txs);
  const keys = cands.map((c) => c.merchantKey);
  assert(keys.includes("NETFLIX"), "5: Netflix detected as recurring (3 months)");
  assert(!keys.some((k) => k.includes("GEHALT")), "5: salary income not a recurring expense");
}

// ── 6. Dot-ATTACHED BIC suffix does not merge into the amount either ──
{
  const dotAttached =
    "Einnahmen / Ausgaben Guthaben 10.05.2026 FIRM GMBH BIC: PZHSDE66.2.380,00 € 5.000,00 €";
  const r = parseStatementText(dotAttached);
  assert(r.length === 1 && r[0].amountMinor === 238000, "6: dot-attached BIC digits (66.) excluded from amount");
}

console.log("[smoke-pdf-parse] PASS");
