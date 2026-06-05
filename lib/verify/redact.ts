export const REDACTION_NOTE = "never leaves the sandbox";

/**
 * Redact a secret to a short, log-safe fingerprint — same shape the action
 * sandbox uses. Never returns enough to reconstruct the token.
 */
export function redactToken(token: string): string {
  if (!token) return "none (no token)";
  // Only a 3-char prefix survives — enough to eyeball "same token across runs",
  // too short to be a useful cross-run fingerprint (sec-review M-2).
  return `${token.slice(0, 3)}…(${token.length} chars, ${REDACTION_NOTE})`;
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  } catch {
    return String(value);
  }
}

/**
 * Throw if the raw `token` appears anywhere in `candidate` (after stringify).
 * The executable form of the C2 no-persistence invariant: call it on any value
 * before it crosses the sandbox boundary into a log, SSE payload, or response.
 * The error message intentionally never contains the token.
 */
export function assertNoToken(token: string, candidate: unknown): void {
  if (!token) return;
  const hay = safeStringify(candidate);
  if (hay.includes(token)) {
    throw new Error("redaction guard: raw session token present in output");
  }
  // A truncated leak (e.g. an error message sliced to 160 chars) would slip past
  // the full-string check — also reject a long identifying prefix (sec-review H-1).
  if (token.length > 32 && hay.includes(token.slice(0, 32))) {
    throw new Error("redaction guard: session token prefix present in output");
  }
}

/** Raw + URL-encoded + base64 forms of an opaque secret, for leak scanning. */
function secretForms(s: string): readonly string[] {
  const forms = [s];
  try {
    forms.push(encodeURIComponent(s));
  } catch {
    /* never blocks a guard */
  }
  try {
    forms.push(Buffer.from(s, "utf8").toString("base64"));
  } catch {
    /* never blocks a guard */
  }
  return forms.filter((f) => f.length >= 6);
}

/**
 * Multi-secret form of {@link assertNoToken} for the switch chain — throws if
 * ANY opaque secret (old cookie, new cookie, payment token, proxy password) or
 * its URL/base64-encoded form appears in `candidate`. Short entries (<6 chars)
 * are skipped to avoid false positives; the short numeric 2FA code is handled
 * by {@link assertNoCode}, never here.
 */
export function assertNoSecrets(
  secrets: readonly string[],
  candidate: unknown,
): void {
  const haystack = safeStringify(candidate);
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    for (const form of secretForms(secret)) {
      if (haystack.includes(form)) {
        throw new Error("redaction guard: a raw secret is present in output");
      }
    }
  }
}

/**
 * Backstop for a short numeric 2FA code, which must NEVER be persisted/emitted.
 * Exact-substring only (the code is structurally never on the record; this is a
 * guard, not a redactor — a 2FA code must never go through `redactToken`, which
 * would leak its prefix).
 */
export function assertNoCode(code: string, candidate: unknown): void {
  if (!code) return;
  if (safeStringify(candidate).includes(code)) {
    throw new Error("redaction guard: a raw 2FA code is present in output");
  }
}
