import { foldForMatch } from "./normalize";
import {
  BRAND_ALLOWLIST,
  buildHolderNameRule,
  isDateLikeRun,
  REDACTION_PLACEHOLDER_WORDS,
  STRUCTURAL_RULES,
  STRUCTURAL_RULES_NO_DIGITRUN,
  type RedactionRule,
} from "./rules";
import { projectRow, RawTxnSchema, type RawTxn } from "./raw-txn";

export interface RedactOptions {
  /** Optional explicit account-holder names to redact (graceful no-op when empty). */
  readonly holderNames?: readonly string[];
}

/** Generic, value-free message shared by the guard — never echoes the PII. */
const PII_GUARD_MESSAGE = "redaction guard: PII present in output";

/** The active rule set for a given option bag: structural rules + optional name rule. */
function activeRules(opts?: RedactOptions): readonly RedactionRule[] {
  // Drop any holder-name entry that collides with a redaction placeholder word
  // (e.g. "IBAN"), which would otherwise match inside an emitted [IBAN] token
  // and corrupt the output to [[NAME]].
  const names = (opts?.holderNames ?? []).filter(
    (n) => !REDACTION_PLACEHOLDER_WORDS.has(n.trim().toUpperCase()),
  );
  const nameRule = buildHolderNameRule(names);
  return nameRule ? [...STRUCTURAL_RULES, nameRule] : STRUCTURAL_RULES;
}

/** Whether a matched span must be LEFT INTACT (brand token, date run, or a non-IBAN). */
function keepSpan(span: string, rule: RedactionRule): boolean {
  if (BRAND_ALLOWLIST.has(span.toUpperCase().trim())) return true;
  if (rule.digitRun && isDateLikeRun(span)) return true;
  // Dropping the IBAN rule's leading \b (to catch "RefDE89…") lets a 2-letter+
  // 2-digit head land mid-word ("hUK24 KFZ VERSICHERUNG"). A real IBAN is
  // digit-heavy; require >= 6 digits so all-letter bodies are not redacted.
  if (rule.id === "iban" && (span.match(/\d/g) ?? []).length < 6) return true;
  return false;
}

/**
 * Apply one rule to `text`. Matching happens on a LENGTH-PRESERVING folded copy
 * (so spaced / lowercased / homoglyph PII is found), but replacement spans are
 * cut from the ORIGINAL `text` — preserving brand casing, umlauts, punctuation.
 */
function applyRule(text: string, rule: RedactionRule): string {
  const folded = foldForMatch(text);
  const re = new RegExp(rule.source, rule.flags);
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(folded)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // defensive: never loop on a zero-width match
    const span = text.slice(start, end); // same indices: fold is 1:1
    if (keepSpan(span, rule)) continue; // leave intact; stays in the pending slice
    out += text.slice(last, start) + rule.replacement;
    last = end;
  }
  return out + text.slice(last);
}

/**
 * Redact PII from a single free-text merchant/description string. Pure,
 * deterministic, and IDEMPOTENT (placeholders contain no re-matchable PII).
 */
export function redactMerchant(text: string, opts?: RedactOptions): string {
  let result = text;
  for (const rule of activeRules(opts)) {
    result = applyRule(result, rule);
  }
  return result;
}

/**
 * Client-side helper: apply the SAME structural redaction across an entire CSV
 * blob before upload, so raw PII never leaves the device. Replacements are
 * inline token swaps that never add commas/newlines, so CSV structure (and
 * date/amount columns, which are below the digit-run threshold) is preserved.
 * This is a best-effort layer; the authoritative per-field redaction is
 * server-side in {@link redactRawTxn}.
 */
export function redactCsvText(csv: string, opts?: RedactOptions): string {
  return redactMerchant(csv, opts);
}

/** Redact the `merchant` field of a RawTxn, returning a new RawTxn. */
export function redactRawTxn(raw: RawTxn, opts?: RedactOptions): RawTxn {
  return RawTxnSchema.parse({
    date: raw.date,
    merchant: redactMerchant(raw.merchant, opts),
    amountMinor: raw.amountMinor,
    currency: raw.currency,
  });
}

/** Build a RawTxn from minimal fields and redact it in one step. */
export function projectAndRedact(
  input: {
    readonly date: string;
    readonly merchant: string;
    readonly amountMinor: number;
    readonly currency: string;
  },
  opts?: RedactOptions,
): RawTxn {
  return redactRawTxn(projectRow(input), opts);
}

// ── PII detection (the guard) ─────────────────────────────────────────────

/** Does any active rule match `s` (a single string), after folding + exemptions? */
function stringHasPII(
  s: string,
  rules: readonly RedactionRule[],
): boolean {
  if (s.length < 6) return false; // noise floor, mirrors assertNoSecrets
  const folded = foldForMatch(s);
  for (const rule of rules) {
    const re = new RegExp(rule.source, rule.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const span = s.slice(m.index, m.index + m[0].length);
      if (!keepSpan(span, rule)) return true;
    }
  }
  return false;
}

/** Best-effort base64 decode (browser + Node 18+ via global atob); null on failure. */
function tryBase64Decode(b64: string): string | null {
  try {
    return typeof atob === "function" ? atob(b64) : null;
  } catch {
    return null;
  }
}

/** Recursively collect string leaves of a value (numbers/booleans skipped). */
function stringLeaves(value: unknown, acc: string[]): string[] {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) stringLeaves(v, acc);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      stringLeaves(v, acc);
    }
  }
  return acc;
}

/**
 * URL-decoded forms of `s` that differ from it. Returns BOTH a whole-string
 * decode (handles multi-byte %C3%BC sequences) AND a per-escape decode (so a
 * single malformed escape like %GG can't throw and disable the whole check).
 */
function urlDecodedForms(s: string): readonly string[] {
  const forms: string[] = [];
  try {
    const whole = decodeURIComponent(s);
    if (whole !== s) forms.push(whole);
  } catch {
    /* malformed somewhere — the per-escape pass below still recovers valid escapes */
  }
  const perEscape = s.replace(/%[0-9A-Fa-f]{2}/g, (m) => {
    try {
      return decodeURIComponent(m);
    } catch {
      return m;
    }
  });
  if (perEscape !== s && perEscape !== forms[0]) forms.push(perEscape);
  return forms;
}

/** True if a single string carries PII in raw, URL-decoded, or base64-decoded form. */
function leakingString(s: string, opts?: RedactOptions): boolean {
  const rules = activeRules(opts);
  if (stringHasPII(s, rules)) return true;

  // URL-decoded forms (e.g. an email's %40), resilient to a malformed escape.
  for (const form of urlDecodedForms(s)) {
    if (stringHasPII(form, rules)) return true;
  }

  // base64-encoded PII: decode long base64-ish substrings and scan them — and
  // their URL-decoded forms — structural-only (no digit-run) to avoid false
  // positives on benign base64 blobs.
  const b64Rules = opts?.holderNames?.length
    ? [...STRUCTURAL_RULES_NO_DIGITRUN, ...rules.filter((r) => r.id === "name")]
    : STRUCTURAL_RULES_NO_DIGITRUN;
  const b64Re = /[A-Za-z0-9+/]{16,}={0,2}/g;
  let m: RegExpExecArray | null;
  while ((m = b64Re.exec(s)) !== null) {
    const decoded = tryBase64Decode(m[0]);
    if (!decoded) continue;
    if (stringHasPII(decoded, b64Rules)) return true;
    for (const form of urlDecodedForms(decoded)) {
      if (stringHasPII(form, b64Rules)) return true;
    }
  }
  return false;
}

/**
 * Fail-closed PII guard. Walks the STRING leaves of `candidate` (numbers are
 * skipped, so JSON floats like a confidence score never trip the digit-run
 * rule) and throws a fixed, value-free error if any leaf carries PII in raw,
 * URL-encoded, or base64-encoded form. This is a GUARD, never a redactor —
 * callers must redact first. The error never contains the offending value.
 */
export function assertNoPII(candidate: unknown, opts?: RedactOptions): void {
  const leaves =
    typeof candidate === "string" ? [candidate] : stringLeaves(candidate, []);
  for (const s of leaves) {
    if (leakingString(s, opts)) {
      throw new Error(PII_GUARD_MESSAGE);
    }
  }
}

/** Non-throwing form of {@link assertNoPII} — true if any PII is present. */
export function hasPII(candidate: unknown, opts?: RedactOptions): boolean {
  const leaves =
    typeof candidate === "string" ? [candidate] : stringLeaves(candidate, []);
  return leaves.some((s) => leakingString(s, opts));
}
