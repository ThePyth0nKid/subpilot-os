/**
 * Length-PRESERVING text folding for PII matching.
 *
 * Every transform here is 1:1 at the UTF-16 unit level, so a match index found
 * on the folded copy maps EXACTLY back onto the original string. That lets the
 * redactor find spaced / lowercased / homoglyph-obfuscated PII on the folded
 * copy while replacing spans in the ORIGINAL — preserving brand casing, German
 * umlauts and punctuation. We deliberately AVOID length-changing normalization
 * (NFKC, ss-expansion) precisely so index alignment always holds.
 *
 * All non-ASCII characters below are written as \u escapes so the mapping is
 * unambiguous in source (a literal lookalike letter is indistinguishable by eye
 * from its ASCII twin).
 */

/** Common Latin-lookalike characters (Cyrillic / Greek) -> ASCII, strictly 1:1. */
const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic uppercase
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M",
  "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T",
  "Х": "X",
  // Cyrillic lowercase
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c",
  "х": "x", "у": "y",
  // Greek uppercase
  "Α": "A", "Β": "B", "Ε": "E", "Ι": "I", "Κ": "K",
  "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T",
  "Χ": "X", "Η": "H", "Ζ": "Z",
};

/** Unicode whitespace that should read as a plain ASCII space for matching. */
const UNICODE_SPACE =
  /[             ​  　\t]/g;

/**
 * Fold a string for matching without changing its length: map confusable
 * letters to ASCII and exotic whitespace to a regular space. `folded[i]`
 * always corresponds to `original[i]`.
 */
export function foldForMatch(text: string): string {
  let out = "";
  for (const ch of text) {
    out += CONFUSABLES[ch] ?? ch;
  }
  return out.replace(UNICODE_SPACE, " ");
}

/** Escape a string for safe literal use inside a RegExp (ReDoS/injection-safe). */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
