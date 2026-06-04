import {
  extractAccountFields,
  normalizeCountry,
} from "@/lib/agents/login-read/parse";
import { computeSavings, deriveStatus } from "@/lib/verify/savings";
import { assertNoToken, redactToken } from "@/lib/verify/redact";
import { LoginProofResultSchema } from "@/lib/domain/login-proof";

/**
 * PURE, CI-safe smoke (no sandbox, no network, no keys) — mirrors
 * smoke-ratelimit.ts. Proves the verify logic + the C2 no-persistence guarantee.
 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-login-redaction] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-login-redaction] ok: ${msg}`);
}

// --- extraction: a logged-in fixture ---
const LOGGED_IN = `<html><body data-sp-auth="true"><h1>Account</h1><div data-sp-plan="Premium"></div><div data-sp-billing-country="DE"></div></body></html>`;
const f1 = extractAccountFields("netflix", LOGGED_IN);
assert(f1.loggedIn === true, "fixture: loggedIn true");
assert(f1.plan === "Premium", "fixture: plan = Premium");
assert(f1.billingCountry === "DE", "fixture: billingCountry = DE");
assert(f1.confidence >= 0.9, "fixture: high confidence");

// --- a login wall hard-disqualifies even with a plan present (review fix) ---
const WALL = `<html><form><input name="password"></form><div data-sp-plan="Premium"></div></html>`;
assert(extractAccountFields("netflix", WALL).loggedIn === false, "login wall ⇒ loggedIn false");

// --- empty / SPA shell is not "logged in" ---
assert(extractAccountFields("spotify", `<html><body>Loading…</body></html>`).loggedIn === false, "empty shell ⇒ loggedIn false");

// --- normalizeCountry ---
assert(normalizeCountry("DE") === "DE", "country: ISO-2 passthrough");
assert(normalizeCountry("de-DE") === "DE", "country: locale → region");
assert(normalizeCountry("Germany") === "DE", "country: display name → ISO-2");
assert(normalizeCountry("") === "", "country: empty → empty");

// --- computeSavings (clamped, never negative) ---
const target = { monthlyEUR: 2.6, fxRateUsed: 0.011, fxAsOf: "2026-05-01" };
const s1 = computeSavings(19.99, target);
assert(Math.abs(s1.savingsEUR - 17.39) < 0.001, "savings: 19.99 → 2.60 = €17.39");
assert(s1.savingsPct > 0.8 && s1.savingsPct <= 1, "savings pct in (0.8,1]");
const s2 = computeSavings(2.0, target);
assert(s2.savingsEUR === 0 && s2.savingsPct === 0, "more-expensive target ⇒ savings clamped to 0");

// --- deriveStatus ---
assert(deriveStatus(false, "mock") === "login_failed", "status: not authenticated ⇒ login_failed");
assert(deriveStatus(true, "mock") === "verified", "status: mock ⇒ verified (geo not claimed)");
assert(deriveStatus(true, "brightdata", true) === "verified_live", "status: brightdata in-country ⇒ verified_live");
assert(deriveStatus(true, "brightdata", false) === "verified", "status: brightdata not-in-country ⇒ verified");

// --- redaction ---
const TOKEN = "sk-secret-cookie-1234567890";
const red = redactToken(TOKEN);
assert(!red.includes("1234567890"), "redact: token tail absent");
assert(red.startsWith(TOKEN.slice(0, 6)), "redact: only a 6-char prefix survives");

// --- C2: a parsed receipt never embeds the raw token ---
const receipt = LoginProofResultSchema.parse({
  service: "netflix",
  status: "verified",
  loggedIn: true,
  currentPlan: "Premium",
  billingCountry: "DE",
  targetCountry: "IN",
  proxyMode: "mock",
  savingsEUR: 17.39,
  savingsPct: 0.87,
  sourceUrl: "https://www.netflix.com/account",
  capturedAt: "2026-06-03T00:00:00.000Z",
  confidence: 0.9,
  tokenRedacted: red,
  audit: [{ at: "2026-06-03T00:00:00.000Z", step: "redact", detail: `token isolated: ${red}` }],
});
assertNoToken(TOKEN, receipt); // must NOT throw — the receipt holds no raw token
assert(!JSON.stringify(receipt).includes(TOKEN), "serialized receipt has no raw token");

// --- the guard DOES throw when a raw token is present ---
let threw = false;
try {
  assertNoToken(TOKEN, { accidental: TOKEN });
} catch {
  threw = true;
}
assert(threw, "assertNoToken throws when a raw token leaks into output");

console.log("[smoke-login-redaction] PASS");
