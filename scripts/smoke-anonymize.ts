import {
  assertNoPII,
  hasPII,
  projectAndRedact,
  redactCsvText,
  redactMerchant,
} from "@/lib/anonymize";
import { parseCsv } from "@/lib/agents/ingest/parse";

/**
 * PURE, zero-env CI gate for PR-M1 (anonymization). No network, no keys, no
 * `_setup` import. Proves: PII (IBAN / account no. / card / email / balance /
 * holder name) is stripped to { date, merchant, amountMinor, currency }; brand
 * tokens survive; the `assertNoPII` guard fails closed without leaking the value
 * AND never false-positives on a realistic float-bearing snapshot.
 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-anonymize] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-anonymize] ok: ${msg}`);
}

const has = (hay: string, needle: string) => hay.includes(needle);
const CYR_E = String.fromCharCode(0x0415); // Cyrillic 'Е' homoglyph of Latin 'E'

// ── 1. Spaced + lowercased IBAN removed (encoding-bypass class) ──
{
  const out = redactCsvText(
    "2024-01-15,Transfer to recipient de89 3704 0044 0532 0130 00,-150.00,EUR",
  );
  assert(!has(out, "de89 3704 0044 0532 0130 00"), "1: spaced/lowercase IBAN removed");
  assert(!has(out, "0532 0130 00"), "1: IBAN tail removed");
  assert(has(out, "[IBAN]"), "1: [IBAN] placeholder present");
  assert(has(out, "Transfer to recipient"), "1: surrounding text preserved");
  assert(has(out, "2024-01-15") && has(out, "150.00"), "1: date + amount preserved");
}

// ── 2. Homoglyph IBAN removed (Cyrillic Е folded to Latin E) ──
{
  const input = `2024-02-01,SEPA D${CYR_E}89 3704 0044 0532 0130 00 ref,-12.00,EUR`;
  const out = redactCsvText(input);
  assert(!has(out, `D${CYR_E}89`), "2: homoglyph IBAN start removed");
  assert(!has(out, "3704 0044 0532"), "2: homoglyph IBAN body removed");
  assert(has(out, "[IBAN]"), "2: homoglyph IBAN → [IBAN]");
}

// ── 3. Account number + balance context removed, amount preserved ──
{
  const out = redactCsvText(
    "2024-03-01,Lastschrift Kontonummer 1234567890123 Saldo 1234.56,-9.99,EUR",
  );
  assert(!has(out, "1234567890123"), "3: 13-digit account number removed");
  assert(has(out, "[ACCT]"), "3: [ACCT] placeholder present");
  assert(has(out, "9.99"), "3: transaction amount preserved");
}

// ── 4. Email removed, brand survives ──
{
  const out = redactCsvText("2024-04-01,NETFLIX.COM billing contact@netflix.de,-19.99,EUR");
  assert(!has(out, "contact@netflix.de"), "4: embedded email removed");
  assert(has(out, "[EMAIL]"), "4: [EMAIL] placeholder present");
  assert(has(out, "NETFLIX") && has(out, "19.99"), "4: brand + amount survive");
}

// ── 5. Brand / plan / currency tokens survive a clean row untouched ──
{
  const out = redactCsvText("2024-05-01,SPOTIFY AB Premium Family,-16.99,EUR");
  for (const tok of ["SPOTIFY", "Premium", "Family", "16.99", "EUR"]) {
    assert(has(out, tok), `5: token survives → ${tok}`);
  }
}

// ── 6. Holder name removed via OPTIONAL allowlist (applied last, brand kept) ──
{
  const out = redactMerchant("Card Holder Max Mustermann NETFLIX", {
    holderNames: ["Max Mustermann"],
  });
  assert(!has(out, "Max Mustermann"), "6: holder name removed via allowlist");
  assert(has(out, "[NAME]"), "6: [NAME] placeholder present");
  assert(has(out, "NETFLIX"), "6: brand preserved after name redaction");
}

// ── 7. Empty holder list = graceful no-op (no heuristic name redaction) ──
{
  const out = redactMerchant("John Smith SPOTIFY");
  assert(has(out, "John Smith"), "7: no name list → name NOT over-redacted");
  assert(has(out, "SPOTIFY"), "7: brand preserved");
}

// ── 8. 16-digit card PAN removed as one token ──
{
  const out = redactCsvText("2024-07-01,CHARGE 4242 4242 4242 4242 SPOTIFY,-12.99,EUR");
  assert(!has(out, "4242 4242 4242 4242"), "8: grouped card PAN removed");
  assert(has(out, "[CARD]") && has(out, "SPOTIFY") && has(out, "12.99"), "8: [CARD] + brand + amount");
}

// ── 9. Short merchant code (<9 digits) + amount NOT misredacted ──
{
  const out = redactCsvText("2024-08-01,AMAZON 123456 order,-49.99,EUR");
  assert(has(out, "123456"), "9: 6-digit code under threshold preserved");
  assert(!has(out, "[ACCT]") && !has(out, "[IBAN]"), "9: no false redaction");
  assert(has(out, "AMAZON") && has(out, "49.99"), "9: brand + amount preserved");
}

// ── 10. Projection: a Transaction carries no rawLine, counterparty is redacted ──
{
  const txs = parseCsv(
    "date,description,amount,currency\n2024-01-15,SPOTIFY DE89370400440532013000,-9.99,EUR",
  );
  assert(txs.length === 1, "10: one transaction parsed");
  const keys = Object.keys(txs[0]);
  assert(!keys.includes("rawLine"), "10: Transaction has NO rawLine field");
  assert(keys.sort().join(",") === "amount,counterparty,date,id", "10: only projected fields kept");
  assert(!has(txs[0].counterparty, "DE89370400440532013000"), "10: IBAN redacted out of counterparty");
  assert(has(txs[0].counterparty, "SPOTIFY"), "10: brand survives in counterparty");
}

// ── 11. assertNoPII THROWS on injected IBAN, error never leaks the value ──
{
  let threw = false;
  let message = "";
  try {
    assertNoPII({ merchantRaw: "NETFLIX DE89 3704 0044 0532 0130 00" });
  } catch (e) {
    threw = true;
    message = e instanceof Error ? e.message : String(e);
  }
  assert(threw, "11: assertNoPII throws on injected IBAN");
  assert(message === "redaction guard: PII present in output", "11: error is the fixed generic string");
  assert(!has(message, "DE89") && !has(message, "0532"), "11: error never contains the IBAN");
}

// ── 12. assertNoPII catches a base64-ENCODED IBAN (decode-and-rescan) ──
{
  const encoded = Buffer.from("DE89 3704 0044 0532 0130 00", "utf8").toString("base64");
  assert(!has(encoded, "DE89 3704"), "12: encoded form does not contain raw IBAN");
  let threw = false;
  try {
    assertNoPII({ ref: encoded });
  } catch {
    threw = true;
  }
  assert(threw, "12: assertNoPII decodes base64 and catches the IBAN");
}

// ── 13. NO false-positive on a realistic redacted snapshot (floats + ISO ts) ──
{
  const snapshot = {
    subscriptions: [
      {
        id: "sub-netflix-eur-19",
        service: "netflix",
        merchantRaw: "NETFLIX.COM [ACCT]",
        merchantNormalized: "Netflix",
        currentPrice: { amountMinor: 1999, currency: "EUR" },
        interval: "monthly",
        currentMonthly: { monthlyEUR: 19.99, fxRateUsed: 1, fxAsOf: "2026-06-03" },
        detectedCountry: "DE",
        currentPlan: "Premium",
        confidence: 0.3163265306122449, // long float → must NOT trip the digit-run rule
        sourceTransactionIds: ["tx-3", "tx-12", "tx-21"],
        optimizable: true,
      },
    ],
    optimization: {
      recommendations: [
        {
          subscriptionId: "sub-netflix-eur-19",
          monthlySavingsEUR: 8.516666666666667,
          annualSavingsEUR: 102.2,
          chosen: {
            country: "IN",
            capturedAt: "2026-06-03T00:00:00.000Z",
            sourceUrl: "https://www.netflix.com/in/",
            confidence: 0.9123456789,
          },
        },
      ],
    },
    report: { headline: "Reclaim 8.52 EUR / month", totalMonthlySavingsEUR: 8.52 },
  };
  assert(!hasPII(snapshot), "13: realistic redacted snapshot has no PII (no float false-positive)");
  let threw = false;
  try {
    assertNoPII(snapshot);
  } catch {
    threw = true;
  }
  assert(!threw, "13: assertNoPII does NOT throw on a clean snapshot");
}

// ── 14. Idempotency: redacting twice equals redacting once ──
{
  const once = redactCsvText("2024-01-01,PAYPAL DE89 3704 0044 0532 0130 00 ref 998877665544,-5.00,EUR");
  const twice = redactCsvText(once);
  assert(once === twice, "14: redaction is idempotent");
  assert(has(once, "[IBAN]"), "14: idempotent redaction still removed the IBAN");
}

// ── 15. projectAndRedact yields exactly the 4 fields, merchant cleaned ──
{
  const t = projectAndRedact({
    date: "2024-01-15",
    merchant: "OPENAI CHATGPT acct 123456789012",
    amountMinor: -2200,
    currency: "EUR",
  });
  assert(Object.keys(t).sort().join(",") === "amountMinor,currency,date,merchant", "15: only 4 fields");
  assert(!has(t.merchant, "123456789012"), "15: account number redacted");
  assert(has(t.merchant, "OPENAI") && has(t.merchant, "CHATGPT"), "15: brand tokens survive");
}

// ── 16. Date-shaped 14-digit account number is redacted, real ISO dates aren't ──
{
  const raw = "SEPA 20240115123456 Verwendungszweck";
  assert(hasPII(raw), "16: bare 14-digit date-shaped account number detected as PII");
  const out = redactMerchant(raw);
  assert(!has(out, "20240115123456"), "16: date-shaped account number redacted");
  assert(has(out, "[ACCT]"), "16: → [ACCT]");
  assert(!hasPII("settled 2026-06-03T12:34:56.000Z ok"), "16: formatted ISO timestamp is NOT a false positive");
  assert(!has(redactCsvText("2024-09-01,SPOTIFY,-9.99,EUR"), "[ACCT]"), "16: real date column survives");
}

// ── 17. IBAN with an alphanumeric prefix (RefDE89…) no longer leaks ──
{
  const glued = "Ref DE89370400440532013000 invoice".replace(" DE", "DE"); // RefDE89…
  assert(hasPII(glued), "17: alpha-prefixed IBAN detected as PII");
  const out = redactMerchant(glued);
  assert(!has(out, "DE89370400440532013000"), "17: alpha-prefixed IBAN redacted");
  assert(has(out, "[IBAN]"), "17: → [IBAN]");
}

// ── 18. Decimal floats in merchant text are NOT over-redacted ──
{
  const out = redactMerchant("PayPal FX rate 1.00456789 conversion fee");
  assert(has(out, "1.00456789"), "18: long decimal preserved (not [ACCT])");
  assert(!has(out, "[ACCT]") && !has(out, "[CARD]"), "18: no false digit redaction");
  const out2 = redactMerchant("model confidence 0.3163265306122449 logged");
  assert(has(out2, "0.3163265306122449"), "18: 16-digit fraction not mistaken for a card PAN");
}

// ── 19. Guard survives a malformed URL escape (%GG) and still finds the email ──
{
  assert(hasPII("contact%40example.com%GGgarbage"), "19: %GG does not disable the URL-decode check");
  assert(!hasPII("totally clean merchant row"), "19: control — clean string is not flagged");
}

// ── 20. Guard catches base64(URL-encoded(PII)) ──
{
  const encoded = Buffer.from("user%40example.com", "utf8").toString("base64");
  let threw = false;
  try {
    assertNoPII({ data: encoded });
  } catch {
    threw = true;
  }
  assert(threw, "20: base64 of a URL-encoded email is decoded twice and caught");
}

// ── 21. Holder name equal to a placeholder word does not corrupt output ──
{
  const out = redactMerchant("DE89370400440532013000 IBAN Holder", { holderNames: ["IBAN"] });
  assert(!has(out, "[[NAME]]"), "21: placeholder-word name does not double-wrap");
  assert(has(out, "[IBAN]"), "21: the real IBAN is still redacted");
}

// ── 22. Privacy decision: a 9+ digit ID in a description is redacted ──
{
  const out = redactMerchant("SPOTIFY 123456789 PREMIUM");
  assert(!has(out, "123456789"), "22: 9-digit id redacted (privacy over clustering fidelity)");
  assert(has(out, "SPOTIFY") && has(out, "PREMIUM"), "22: brand + plan survive");
}

console.log("[smoke-anonymize] PASS");
