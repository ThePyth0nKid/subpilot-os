import "./_setup";
import { MockProxy } from "@/lib/providers/proxy/mock";
import { runLoginRead } from "@/lib/agents/login-read";

/**
 * INTEGRATION smoke — spins up a REAL ephemeral Daytona sandbox (proves
 * sandbox bring-up) and runs the read-only login proof against the MOCK proxy
 * with a deterministic fixture and a `test:` token. ZERO account risk: no real
 * provider, no real cookie. Requires DAYTONA_API_KEY (+ the env loadEnv needs)
 * in .env.local. Set TEST_SESSION_TOKEN to override the dummy token.
 *
 *   npx tsx scripts/smoke-login-proof.ts
 */
const FIXTURE = `<!doctype html><html><body data-sp-auth="true">
  <h1>Account</h1>
  <div data-sp-plan="Premium"></div>
  <div data-sp-billing-country="DE"></div>
</body></html>`;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-login-proof] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-login-proof] ok: ${msg}`);
}

async function main() {
  const token = process.env.TEST_SESSION_TOKEN || "test:dummy-session-cookie";
  const proxy = new MockProxy();
  console.log(`[smoke-login-proof] proxy=mock token=${token.startsWith("test:") ? "test" : "real"}`);

  // Account lives in DE (fixture billing-country) at €19.99; we probe whether
  // India (IN) — a cheaper region — is viable. Savings = DE price − IN estimate.
  const result = await runLoginRead(
    {
      service: "netflix",
      country: "IN",
      sessionToken: token,
      currentMonthlyEUR: 19.99,
      accountFixtureHtml: FIXTURE,
    },
    { proxy, onEvent: (e) => console.log(`  · [${e.phase}] ${e.message}`) },
  );

  const serialized = JSON.stringify(result);
  assert(result.loggedIn === true, "authenticated against fixture inside a real sandbox");
  assert(result.currentPlan === "Premium", "plan parsed in-sandbox");
  assert(result.billingCountry === "DE", "account billing country parsed + normalized (DE)");
  assert(result.targetCountry === "IN", "target country probed (IN)");
  assert(result.proxyMode === "mock", "proxy mode reported as mock");
  assert(result.status === "verified", "status = verified (mechanics; geo not claimed on mock)");
  assert(result.savingsEUR > 0, "savings computed (DE → IN is cheaper)");
  assert(!serialized.includes(token), "raw session token ABSENT from the receipt");
  assert(result.tokenRedacted.length > 0 && !result.tokenRedacted.includes(token), "token only present redacted");

  console.log("\n[smoke-login-proof] receipt:\n" + JSON.stringify(result, null, 2));
  console.log("[smoke-login-proof] PASS");
}

main().catch((e) => {
  console.error("[smoke-login-proof] FAILED:", e);
  process.exit(1);
});
