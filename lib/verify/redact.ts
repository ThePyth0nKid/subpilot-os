export const REDACTION_NOTE = "never leaves the sandbox";

/**
 * Redact a secret to a short, log-safe fingerprint — same shape the action
 * sandbox uses. Never returns enough to reconstruct the token.
 */
export function redactToken(token: string): string {
  if (!token) return "none (no token)";
  return `${token.slice(0, 6)}…(${token.length} chars, ${REDACTION_NOTE})`;
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
  if (safeStringify(candidate).includes(token)) {
    throw new Error("redaction guard: raw session token present in output");
  }
}
