import {
  LoginProofResultSchema,
  type LoginProofResult,
} from "@/lib/domain/login-proof";
import { countryInfo, FALLBACK_EUR } from "@/lib/agents/geo-research/countries";
import { EUR_PER_UNIT, toMonthlyEUR } from "@/lib/domain/fx";
import type { Money, NormalizedPrice } from "@/lib/domain/money";
import { emitter, type OnEvent } from "@/lib/agents/emit";
import type { ProxyProvider } from "@/lib/providers";
import { runVerifyInSandbox, type VerifySandboxOutput } from "@/lib/daytona/verify-sandbox";
import { runBrowserRead, type BrowserCookie } from "@/lib/daytona/browser-sandbox";
import { assertNoToken } from "@/lib/verify/redact";
import { computeSavings, deriveStatus } from "@/lib/verify/savings";
import { normalizeCountry, type Target } from "./parse";
import { accountPageUrl, sessionCookieSpec } from "./sources";

/**
 * `curl` is fast and sufficient for static/fixture pages; `browser` renders the
 * real JS app (ChatGPT, Spotify, etc.) that curl only sees as an empty shell.
 */
export type ReadEngine = "curl" | "browser";

export interface LoginReadInput {
  readonly service: Target;
  readonly country: string; // target country (ISO-2)
  readonly sessionToken: string; // real cookie, or a "test:"-prefixed fixture token
  readonly currentMonthlyEUR?: number; // user's current price (drives savings)
  readonly accountFixtureHtml?: string; // deterministic HTML for test tokens
  readonly engine?: ReadEngine; // default "curl"
  /**
   * Same-market read (e.g. cancel our own DE account from DE) — NO geo claim, so
   * the "don't send a real cookie over datacenter egress" refusal does not apply.
   * The cookie-exfiltration allowlist requirement still holds. Default false.
   */
  readonly sameMarketDirect?: boolean;
}

export interface LoginReadDeps {
  readonly proxy: ProxyProvider;
  readonly runId?: string;
  readonly onEvent?: OnEvent;
  /** Comma-separated CIDRs the sandbox may egress to (Bright Data proxy range).
   *  REQUIRED for real-cookie runs — the run is refused without it (C3). */
  readonly networkAllowList?: string;
}

/** Per-service sanity check on the pasted cookie VALUE (sec-review M-3). */
const COOKIE_FORMAT: Partial<Record<Target, RegExp>> = {
  chatgpt: /^ey[A-Za-z0-9_-]{8,}/, // NextAuth JWT
};

/**
 * Build the browser cookie(s) to inject. In test mode (fixture render) we pass
 * none — the page is set via setContent, no auth needed. For a real run the
 * supplied token is the cookie VALUE for the service's session cookie.
 */
function buildCookies(
  service: Target,
  sessionToken: string,
  testMode: boolean,
): readonly BrowserCookie[] {
  if (testMode) return [];
  if (sessionToken.includes("=")) {
    throw new Error(
      "Session token looks like a name=value pair — paste only the cookie VALUE.",
    );
  }
  const fmt = COOKIE_FORMAT[service];
  if (fmt && !fmt.test(sessionToken)) {
    throw new Error(
      `Session token format mismatch for ${service} — check you copied the right cookie value.`,
    );
  }
  const spec = sessionCookieSpec(service);
  return [{ name: spec.name, value: sessionToken, domain: spec.domain, path: "/" }];
}

/** Approximate target-country price from the static regional table (no Tavily). */
function estimateTargetPrice(
  service: Target,
  country: string,
): { price: Money; normalized: NormalizedPrice } {
  const info = countryInfo(country);
  const table = FALLBACK_EUR[service];
  const eur = table[country.toUpperCase()] ?? table.US ?? 10;
  const rate = EUR_PER_UNIT[info.currency] ?? 1;
  const price: Money = {
    amountMinor: Math.round((eur / rate) * 100),
    currency: info.currency,
  };
  return { price, normalized: toMonthlyEUR(price, "monthly") };
}

/**
 * STAGE 1 — read-only login proof for one service × country. Proves a supplied
 * session token authenticates inside an ephemeral sandbox, reads the plan +
 * billing country, and verifies in-country egress — WITHOUT any mutation.
 *
 * Safety refusals (fail-closed, threat-model C1/C3):
 * - A real cookie is NEVER sent without a residential proxy (datacenter egress
 *   would trigger a security hold / 2FA / cookie invalidation on the account).
 * - A real-cookie run requires an enforced egress allowlist so a compromised
 *   in-sandbox dependency can't exfiltrate the cookie to an arbitrary host.
 * Use a `test:`-prefixed token + `accountFixtureHtml` to prove the mechanics
 * with zero account risk on the mock proxy.
 */
export async function runLoginRead(
  input: LoginReadInput,
  deps: LoginReadDeps,
): Promise<LoginProofResult> {
  const emit = emitter("login-read", deps.runId ?? "local", deps.onEvent);
  const { service, country, sessionToken, currentMonthlyEUR = 0 } = input;
  const engine: ReadEngine = input.engine ?? "curl";
  const testMode = sessionToken.startsWith("test:");
  const proxyCfg = deps.proxy.forCountry(country);

  // Geo guard: a real cookie sent over datacenter egress while pretending to be
  // in another country risks a security hold. It does NOT apply to a same-market
  // read (no geo claim) — but the operator must opt in explicitly (C1).
  if (!testMode && proxyCfg.mode !== "brightdata" && !input.sameMarketDirect) {
    throw new Error(
      "Refusing to send a real session cookie without a residential proxy — " +
        "datacenter egress would risk the account. Configure BRIGHTDATA_*, set " +
        "sameMarketDirect for an own-country read, or use a 'test:' token.",
    );
  }
  // Exfil guard: a real cookie always needs a bounded egress allowlist so a
  // compromised in-sandbox dependency can't ship it to an arbitrary host (C3).
  let network: { allowList: string } | undefined;
  if (!testMode) {
    if (!deps.networkAllowList) {
      throw new Error(
        "Refusing a real-cookie run without an egress allowlist — sandbox egress " +
          "would be unbounded. Set the proxy/service CIDRs in networkAllowList.",
      );
    }
    network = { allowList: deps.networkAllowList };
  }

  emit(
    "started",
    `Login-read · ${service} × ${country} via ${proxyCfg.mode} (${engine})`,
    { country },
  );
  // Make the accepted risk loud: sameMarketDirect relaxes the geo guard ONLY —
  // the cookie still leaves over a datacenter IP and may trip a security check.
  if (!testMode && input.sameMarketDirect && proxyCfg.mode !== "brightdata") {
    emit(
      "progress",
      "⚠ sameMarketDirect: real cookie egresses via datacenter IP (no residential proxy) — egress allowlist enforced.",
      { country },
    );
  }

  const out: VerifySandboxOutput =
    engine === "browser"
      ? await runBrowserRead({
          service,
          accountUrl: accountPageUrl(service),
          cookies: buildCookies(service, sessionToken, testMode),
          rawToken: sessionToken,
          proxy: proxyCfg,
          accountFixtureHtml: input.accountFixtureHtml,
          network,
        })
      : await runVerifyInSandbox({
          service,
          targetCountry: country,
          sessionToken,
          accountUrl: accountPageUrl(service),
          proxy: proxyCfg,
          accountFixtureHtml: input.accountFixtureHtml,
          network,
        });

  emit(
    "progress",
    `Sandbox ${out.sandboxId.slice(0, 8)} · ${out.loggedIn ? "authenticated" : "not authenticated"}`,
    { country, sandboxId: out.sandboxId },
  );

  const billingCountry = normalizeCountry(out.billingCountryRaw);
  const inCountry = out.egressCountry
    ? out.egressCountry === country.toUpperCase()
    : undefined;
  const { price, normalized } = estimateTargetPrice(service, country);
  const { savingsEUR, savingsPct } = computeSavings(currentMonthlyEUR, normalized);
  // A positive cancellation marker (Stage 2 verify-cancel) wins over the
  // generic read status — it proves the old plan is gone, not just logged in.
  const status = out.cancelled
    ? "subscription_cancelled"
    : deriveStatus(out.loggedIn, proxyCfg.mode, inCountry);
  const at = new Date().toISOString();

  const result = LoginProofResultSchema.parse({
    service,
    status,
    loggedIn: out.loggedIn,
    currentPlan: out.plan,
    billingCountry,
    targetCountry: country.toUpperCase(),
    inCountry,
    egressCountry: out.egressCountry,
    proxyMode: proxyCfg.mode,
    currentMonthlyEUR: currentMonthlyEUR || undefined,
    targetPrice: price,
    targetMonthly: normalized,
    savingsEUR,
    savingsPct,
    sourceUrl: accountPageUrl(service),
    capturedAt: at,
    confidence: out.confidence,
    tokenRedacted: out.tokenRedacted,
    audit: out.steps.map((s) => ({ at, step: s.step, detail: s.detail })),
  } satisfies LoginProofResult);

  // C2 belt-and-suspenders: the parsed receipt must never embed the raw token.
  assertNoToken(sessionToken, result);

  emit(
    "completed",
    out.loggedIn
      ? `${service}: plan "${result.currentPlan}" · ${result.billingCountry || "??"} · save €${result.savingsEUR.toFixed(2)}/mo`
      : `${service}: not authenticated`,
    { country, sandboxId: out.sandboxId, payload: result },
  );
  return result;
}
