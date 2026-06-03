/**
 * Parse a bank-statement amount into signed minor units (cents), robust to:
 * - decimal comma ("1.234,56") AND decimal point ("1,234.56" / "-17.22"),
 * - thousands separators, currency symbols, surrounding whitespace,
 * - negatives via a leading/trailing minus or parentheses "(12.34)".
 *
 * Returns null when no finite number can be read.
 */
export function parseAmountMinor(raw: unknown): number | null {
  let s = (raw == null ? "" : String(raw)).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // A minus anywhere before the first digit (handles "$-12.99", "EUR -12.99")
  // or a trailing minus ("12,34-") marks a debit.
  const firstDigit = s.search(/\d/);
  const prefix = firstDigit >= 0 ? s.slice(0, firstDigit) : s;
  if (prefix.includes("-") || /-\s*$/.test(s)) negative = true;

  // Keep only digits and the two possible separators.
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let decimalSep = "";
  if (lastComma !== -1 && lastDot !== -1) {
    decimalSep = lastComma > lastDot ? "," : "."; // rightmost wins
  } else if (lastComma !== -1) {
    const after = s.length - lastComma - 1;
    decimalSep = after === 1 || after === 2 ? "," : ""; // ",d"/",dd" → decimal, else thousands
  } else if (lastDot !== -1) {
    const after = s.length - lastDot - 1;
    decimalSep = after === 1 || after === 2 ? "." : "";
  }

  let normalized: string;
  if (decimalSep) {
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = s.split(thousandsSep).join("").replace(decimalSep, ".");
  } else {
    normalized = s.replace(/[.,]/g, ""); // all separators are thousands
  }

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  const minor = Math.round(value * 100);
  return negative ? -minor : minor;
}

/** Map a currency symbol embedded in an amount string to an ISO-4217 code. */
export function currencyFromSymbol(raw: string): string | null {
  if (raw.includes("€")) return "EUR";
  if (raw.includes("£")) return "GBP";
  if (raw.includes("$")) return "USD";
  return null;
}
