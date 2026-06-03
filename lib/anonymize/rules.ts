import { escapeRegExp } from "./normalize";

/**
 * The ordered, structural redaction rules. Order is SIGNIFICANT and immutable:
 * the most specific token (IBAN, then email, then a grouped card PAN) runs
 * before the generic long-digit-run, so a specific token's digits are consumed
 * as one placeholder instead of being double-tagged as [ACCT].
 *
 * Patterns are stored as source strings + flags (RegExp objects are stateful
 * with the `g` flag, so callers compile a fresh RegExp per use).
 */
export interface RedactionRule {
  readonly id: string;
  readonly replacement: string;
  readonly source: string;
  readonly flags: string;
  /** True for the generic digit-run rule (gets the date-shape exemption). */
  readonly digitRun?: boolean;
}

export const STRUCTURAL_RULES: readonly RedactionRule[] = [
  {
    id: "iban",
    replacement: "[IBAN]",
    // 2-letter country + 2 check digits + 11..30 alnum, optional grouping separators.
    // No leading \b: an alpha prefix glued to the country code ("RefDE89…") leaves
    // no word boundary, so anchoring on the start would let the IBAN leak.
    source: String.raw`[A-Z]{2}\d{2}(?:[ \-.]?[A-Z0-9]){11,30}\b`,
    flags: "gi",
  },
  {
    id: "email",
    replacement: "[EMAIL]",
    source: String.raw`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`,
    flags: "gi",
  },
  {
    id: "card",
    replacement: "[CARD]",
    // 16-digit PAN with optional space/hyphen grouping. Lookbehind/lookahead
    // (not \b) so a 16-digit decimal fraction ("0.3163265306122449") is not
    // mistaken for a PAN — \b would fire after the leading dot.
    source: String.raw`(?<![.\d])\d{4}(?:[ \-]?\d{4}){3}(?![.\d])`,
    flags: "g",
  },
  {
    id: "acct",
    replacement: "[ACCT]",
    // >= 9 digits (account / reference numbers), grouped by space or hyphen only.
    // Lookbehind/lookahead anchor the WHOLE numeric token so a long decimal
    // fraction (0.3163265306122449, FX 1.00456789) is never misread as an
    // account number. `.` is intentionally NOT a separator here (banks group
    // account numbers with spaces/hyphens; dots appear in amounts).
    source: String.raw`(?<![.\d])\d(?:[ \-]?\d){8,}(?![.\d])`,
    flags: "g",
    digitRun: true,
  },
];

/** Structural rules that are safe to run on base64-DECODED text (no digit-run, to avoid blob false-positives). */
export const STRUCTURAL_RULES_NO_DIGITRUN: readonly RedactionRule[] =
  STRUCTURAL_RULES.filter((r) => !r.digitRun);

/**
 * Brand / plan / currency / country tokens that MUST survive every rule so
 * downstream classification + clustering still work. Checked case-insensitively
 * against each matched span before any replacement.
 */
export const BRAND_ALLOWLIST: ReadonlySet<string> = new Set(
  [
    "NETFLIX", "NETFLIX.COM", "SPOTIFY", "YOUTUBE", "YOUTUBEPREMIUM",
    "DISNEY", "DISNEY+", "CHATGPT", "OPENAI", "AMAZON", "APPLE",
    "APPLE.COM", "GOOGLE", "MICROSOFT", "PREMIUM", "FAMILY", "STANDARD",
    "BASIC", "MONTHLY", "YEARLY", "QUARTERLY",
    "EUR", "USD", "GBP", "INR", "CNY", "JPY",
  ].map((s) => s.toUpperCase()),
);

/** The placeholder words our rules emit (used by clustering to ignore them). */
export const REDACTION_PLACEHOLDER_WORDS: ReadonlySet<string> = new Set([
  "IBAN", "EMAIL", "CARD", "ACCT", "NAME",
]);

/**
 * A digit run that is a FORMATTED ISO date / datetime (YYYY-MM-DD[ HH:MM]) — i.e.
 * carries a date separator. A bare contiguous digit run (no separator) is ALWAYS
 * treated as an account/reference number and redacted, even if its digits happen
 * to be date-shaped (e.g. a 14-digit `20240115123456` account number). The
 * exemption only protects genuinely formatted date columns from the client-side
 * whole-CSV pass; the optional time is capped (\d{0,4}) so longer runs fall
 * through to [ACCT].
 */
export function isDateLikeRun(span: string): boolean {
  if (!/[ \-./]/.test(span)) return false; // bare number → never date-exempt
  const digits = span.replace(/[ \-./]/g, "");
  return /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{0,4}$/.test(
    digits,
  );
}

/**
 * Compile the OPTIONAL holder-name rule from an explicit allowlist. Entries are
 * trimmed, dropped if <3 chars, RegExp-escaped (ReDoS/injection-safe), and
 * sorted longest-first so "Max Mustermann" matches before "Max". Returns null
 * when the list is empty → the name rule is a graceful no-op.
 */
export function buildHolderNameRule(
  names: readonly string[],
): RedactionRule | null {
  const cleaned = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (cleaned.length === 0) return null;
  return {
    id: "name",
    replacement: "[NAME]",
    source: String.raw`\b(?:` + cleaned.join("|") + String.raw`)\b`,
    flags: "gi",
  };
}

/** Split a comma/semicolon/newline separated env string into a holder-name list. */
export function parseHolderNames(raw: string | undefined | null): readonly string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
