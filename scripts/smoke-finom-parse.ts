import { readFileSync } from "node:fs";
import { parseCsv } from "@/lib/agents/ingest/parse";
import { clusterRecurring } from "@/lib/agents/ingest/cluster";
import { parseAmountMinor } from "@/lib/agents/ingest/amount";
import { parseDateToIso } from "@/lib/agents/ingest/date";
import { detectColumns, detectDelimiter } from "@/lib/agents/ingest/csv-schema";

/**
 * PURE, zero-env gate for PR-M2 (real Finom CSV parser). Verifies the schema
 * detection, robust amount/date parsing, and that a real-shaped (anonymized)
 * Finom export flows through the M1 anonymization boundary into recognised
 * recurring subscriptions — with NO PII surviving.
 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-finom-parse] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-finom-parse] ok: ${msg}`);
}
const has = (h: string, n: string) => h.includes(n);

// ── 1. Amount parsing: decimal point, comma, thousands, parentheses, symbols ──
assert(parseAmountMinor("-17.22") === -1722, "1: decimal point negative");
assert(parseAmountMinor("3500.00") === 350000, "1: decimal point large");
assert(parseAmountMinor("1.234,56") === 123456, "1: EU decimal comma + dot thousands");
assert(parseAmountMinor("1,234.56") === 123456, "1: US decimal point + comma thousands");
assert(parseAmountMinor("17,22") === 1722, "1: plain decimal comma");
assert(parseAmountMinor("1.234") === 123400, "1: dot thousands, no decimals → 1234.00");
assert(parseAmountMinor("(12.34)") === -1234, "1: parentheses = negative");
assert(parseAmountMinor("12,99 €") === 1299, "1: trailing currency symbol stripped");
assert(parseAmountMinor("") === null && parseAmountMinor("abc") === null, "1: empty/garbage → null");

// ── 2. Date normalization to ISO ──
assert(parseDateToIso("03.06.2026 11:26:05") === "2026-06-03", "2: Finom DD.MM.YYYY HH:MM:SS → ISO");
assert(parseDateToIso("2026-06-03") === "2026-06-03", "2: ISO passes through");
assert(parseDateToIso("03/06/2026") === "2026-06-03", "2: DD/MM/YYYY (EU) → ISO");
assert(parseDateToIso("2026/06/03") === "2026-06-03", "2: YYYY/MM/DD → ISO");
assert(parseDateToIso("1.2.2026") === "2026-02-01", "2: single-digit day/month padded");

// ── 3. Column + delimiter detection (German Finom + English + Soll/Haben) ──
{
  const finom = detectColumns(["Buchungsdatum", "Auftraggeber/Empfänger", "Verwendungszweck", "Betrag"]);
  assert(finom.date === "Buchungsdatum" && finom.merchant === "Auftraggeber/Empfänger", "3: Finom headers mapped");
  assert(finom.reference === "Verwendungszweck" && finom.amount === "Betrag", "3: reference + amount mapped");
  const en = detectColumns(["Date", "Description", "Amount", "Currency"]);
  assert(en.date === "Date" && en.merchant === "Description" && en.amount === "Amount" && en.currency === "Currency", "3: English headers mapped");
  const sollHaben = detectColumns(["Datum", "Empfänger", "Soll", "Haben"]);
  assert(sollHaben.debit === "Soll" && sollHaben.credit === "Haben", "3: Soll/Haben → debit/credit");
  assert(detectDelimiter("a,b,c") === "," && detectDelimiter("a;b;c") === ";", "3: delimiter sniffing");
}

// ── 4. Integration: the synthetic Finom fixture → redacted, clustered subs ──
{
  const csv = readFileSync("fixtures/finom-sample.csv", "utf8");
  const txs = parseCsv(csv);
  assert(txs.length === 22, "4: all 22 rows parse (incl. income)");
  assert(txs.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date)), "4: every date normalized to ISO");

  const netflix = txs.find((t) => t.counterparty.includes("NETFLIX"));
  assert(netflix?.amount.amountMinor === -1299 && netflix.amount.currency === "EUR", "4: Netflix amount -12.99 EUR");

  // No PII survives: IBAN, invoice numbers, or any 9+ digit run.
  assert(!txs.some((t) => /[0-9]{9,}/.test(t.counterparty)), "4: no 9+ digit run in any counterparty");
  assert(!txs.some((t) => t.counterparty.replace(/\s/g, "").includes("DE89370400440532013000")), "4: transfer IBAN redacted out");
  assert(txs.some((t) => t.counterparty.includes("[IBAN]")), "4: the SEPA IBAN became [IBAN]");
  assert(txs.some((t) => t.counterparty.includes("[ACCT]")), "4: the invoice number became [ACCT]");

  // Recurring detection: 4 subs across 3 months; income + variable spend excluded.
  const cands = clusterRecurring(txs);
  const keys = cands.map((c) => c.merchantKey);
  for (const brand of ["NETFLIX", "SPOTIFY", "ANTHROPIC", "CURSOR"]) {
    assert(keys.includes(brand), `4: recurring detected → ${brand}`);
  }
  assert(cands.length === 4, "4: exactly 4 recurring candidates (income + variable spend excluded)");
  assert(!keys.some((k) => k.includes("GEHALT")), "4: salary income is not a recurring expense");
}

// ── 5. "Umsatzart" must NOT hijack the amount column (Sparkasse/DKB) ──
{
  const m = detectColumns(["Buchungstag", "Auftraggeber/Empfänger", "Umsatzart", "Betrag"]);
  assert(m.amount === "Betrag", "5: Umsatzart does not claim amount; Betrag does");
}

// ── 6. Sign before a currency symbol; single-digit decimals ──
assert(parseAmountMinor("$-12.99") === -1299, "6: $-12.99 stays negative");
assert(parseAmountMinor("-€5.00") === -500, "6: -€5.00 negative");
assert(parseAmountMinor("1.5") === 150, "6: 1.5 → 1.50");
assert(parseAmountMinor("1.50") === 150, "6: 1.50 → 150");
assert(parseAmountMinor("1.234") === 123400, "6: 1.234 still read as thousands");

// ── 7. Invalid dates rejected; 2-digit years pivoted ──
assert(parseDateToIso("31.02.2026") === "", "7: impossible day rejected → ''");
assert(parseDateToIso("99.99.9999") === "", "7: garbage date rejected → ''");
assert(parseDateToIso("2026-13-01") === "", "7: invalid ISO month rejected → ''");
assert(parseDateToIso("15.03.26") === "2026-03-15", "7: 2-digit year pivots to 2026");

// ── 8. Fail loud on unrecognized schema; unsafe amount dropped, no crash ──
{
  let threwAmount = false;
  try { parseCsv("Date,Merchant\n2026-06-01,Netflix"); } catch { threwAmount = true; }
  assert(threwAmount, "8: missing amount column throws (not silent [])");
  let threwDate = false;
  try { parseCsv("Betrag,Empfänger\n-9.99,Netflix"); } catch { threwDate = true; }
  assert(threwDate, "8: missing date column throws");
  const huge = parseCsv("Buchungsdatum,Auftraggeber/Empfänger,Betrag\n01.06.2026,BIG,90071992547410.00");
  assert(huge.length === 0, "8: unsafe-large amount row dropped without a ZodError crash");
}

// ── 9. Delimiter sniffed from the body, robust to commas inside quoted fields ──
assert(detectDelimiter("a;b;c\n1;2;3") === ";", "9: semicolon delimiter detected");
assert(
  detectDelimiter('Datum;Empfänger;Betrag\n01.06.2026;"Foo, Bar";-9,99') === ";",
  "9: semicolon wins despite a comma inside a quoted field",
);

console.log("[smoke-finom-parse] PASS");
