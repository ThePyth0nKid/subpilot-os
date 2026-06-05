import "./_setup";
import { readFileSync } from "node:fs";
import { MockProxy } from "@/lib/providers/proxy/mock";
import { runLoginRead } from "@/lib/agents/login-read";

/**
 * STAGE 0 — LIVE read-only login proof against Nelson's OWN ChatGPT account.
 * READ-ONLY: it renders the account page and reads the plan. It NEVER clicks,
 * changes, cancels, or pays. Fully reversible (nothing is mutated).
 *
 * Setup:
 *   1. chatgpt.com (logged in) → F12 → Application → Cookies → https://chatgpt.com
 *   2. copy the value of `__Secure-next-auth.session-token`
 *   3. save it to:  .secrets/chatgpt-cookie.txt   (gitignored; one line, the value only)
 *   4. npx tsx scripts/stage0-chatgpt-read.ts
 *
 * Security posture (threat-model):
 *   - same-market read (DE account from our egress) → no geo claim (C1 relaxed
 *     via sameMarketDirect), but the cookie-exfil egress allowlist still applies.
 *   - the cookie lives ONLY inside the ephemeral sandbox, is redacted in every
 *     log/receipt, and dies on teardown. Nothing is persisted.
 *
 * NOTE: a datacenter egress MAY still trip Cloudflare / a security challenge on
 * OpenAI. If `loggedIn:false`, that's the expected "needs residential egress or
 * a fresher cookie" signal — exactly what Stage 0 exists to find out cheaply.
 */
const COOKIE_FILE = ".secrets/chatgpt-cookie.txt";
// Service-domain egress allowlist (cookie-exfil guard, C3). Cloudflare ranges
// that serve chatgpt.com — deliberately NO 0.0.0.0/0 catch-all, so a tampered
// in-sandbox dependency cannot ship the cookie to an arbitrary host. Refine
// once we observe the real egress IPs from a first run.
const ALLOWLIST =
  process.env.SP_ALLOWLIST ??
  "104.16.0.0/13,172.64.0.0/13,162.158.0.0/15,173.245.48.0/20";

async function main() {
  let token: string;
  try {
    token = readFileSync(COOKIE_FILE, "utf8").trim();
  } catch {
    console.error(
      `\n[stage0] No cookie found at ${COOKIE_FILE}.\n` +
        "  → see the setup steps at the top of this file.\n",
    );
    process.exit(1);
  }
  if (!token || token.startsWith("test:")) {
    console.error("[stage0] cookie file is empty or a test token — paste the real value.");
    process.exit(1);
  }

  console.log("[stage0] LIVE read-only proof against your ChatGPT account (no mutation)…");
  const result = await runLoginRead(
    {
      service: "chatgpt",
      country: "DE",
      sessionToken: token,
      currentMonthlyEUR: 30.7,
      engine: "browser",
      sameMarketDirect: true,
    },
    {
      proxy: new MockProxy(),
      networkAllowList: ALLOWLIST,
      onEvent: (e) => console.log(`  · ${e.agent}: ${e.message}`),
    },
  );

  console.log("\n[stage0] RESULT");
  console.log(`  status      : ${result.status}`);
  console.log(`  loggedIn    : ${result.loggedIn}`);
  console.log(`  plan        : ${result.currentPlan || "(not parsed)"}`);
  console.log(`  billing     : ${result.billingCountry || "(unknown)"}`);
  console.log(`  confidence  : ${result.confidence}`);
  console.log(`  token       : ${result.tokenRedacted}`);
  if (!result.loggedIn) {
    console.log(
      "\n  → not authenticated: likely a Cloudflare challenge on datacenter egress,\n" +
        "    or an expired cookie. Next step = residential DE egress (Bright Data zone)\n" +
        "    or a freshly-copied cookie.",
    );
  } else {
    console.log("\n  ✓ Stage 0 proven — we can read your account. Stage 1 (cancel dry-run) is next.");
  }
}

main().catch((err: unknown) => {
  console.error(`[stage0] FAIL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
