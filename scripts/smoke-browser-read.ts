import "./_setup";
import { MockProxy } from "@/lib/providers/proxy/mock";
import { runLoginRead } from "@/lib/agents/login-read";

/**
 * INTEGRATION smoke — spins up a REAL ephemeral Daytona sandbox, installs
 * playwright-core, and renders a deterministic account FIXTURE in a real
 * headless browser (system chromium). Proves the browser-read mechanics +
 * PATTERNS extraction with ZERO account risk: no real provider, no real cookie.
 *
 * Requires DAYTONA_API_KEY in .env.local. The same code path with a real
 * `__Secure-next-auth.session-token` value (and the same-market / allowlist
 * gates) is what powers Stage-0 against a live ChatGPT account.
 *
 *   npx tsx scripts/smoke-browser-read.ts
 */
const FIXTURE = `<!doctype html><html><body data-sp-auth="true">
  <h1>Account</h1>
  <div data-sp-plan="ChatGPT Plus"></div>
  <div data-sp-billing-country="DE"></div>
  <p>Your subscription renews monthly.</p>
</body></html>`;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-browser-read] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-browser-read] ok: ${msg}`);
}

async function main() {
  const proxy = new MockProxy();
  console.log("[smoke-browser-read] rendering fixture in a real headless browser…");

  const result = await runLoginRead(
    {
      service: "chatgpt",
      country: "DE",
      sessionToken: "test:dummy-session-cookie",
      currentMonthlyEUR: 30.7,
      accountFixtureHtml: FIXTURE,
      engine: "browser",
    },
    { proxy },
  );

  assert(result.loggedIn, "authenticated against the rendered fixture");
  assert(result.currentPlan === "ChatGPT Plus", `plan extracted ("${result.currentPlan}")`);
  assert(result.billingCountry === "DE", "billing country DE extracted");
  assert(result.service === "chatgpt", "service preserved");
  assert(result.proxyMode === "mock", "mock proxy (no real egress)");
  assert(
    !JSON.stringify(result).includes("dummy-session-cookie"),
    "raw token never appears in the receipt",
  );
  assert(result.tokenRedacted.includes("chars"), "token redacted in the audit");
  console.log("[smoke-browser-read] PASS");
}

main().catch((err: unknown) => {
  console.error(`[smoke-browser-read] FAIL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
