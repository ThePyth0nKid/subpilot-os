import type { ProxyConfig } from "@/lib/providers";
import { runShell, withSandbox, type SandboxNetwork } from "@/lib/daytona/runner";
import { proxyShell } from "@/lib/daytona/proxy-shell";
import { redactToken } from "@/lib/verify/redact";
import { PATTERNS, type Target } from "@/lib/agents/login-read/parse";
import type { ActionStep } from "@/lib/daytona/action-sandbox";
import type { VerifySandboxOutput } from "@/lib/daytona/verify-sandbox";

/** A single cookie to inject into the browser context (real-cookie runs). */
export interface BrowserCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string; // e.g. "chatgpt.com" or ".chatgpt.com"
  readonly path?: string;
}

export interface BrowserReadInput {
  readonly service: Target;
  readonly accountUrl: string;
  readonly cookies: readonly BrowserCookie[]; // empty in test mode
  readonly rawToken: string; // for audit redaction only (never sent verbatim)
  readonly proxy: ProxyConfig;
  readonly accountFixtureHtml?: string; // test mode: rendered via setContent
  readonly network?: SandboxNetwork; // egress allowlist (real-cookie runs)
}

const MARKER = "__BR__";

/** A version pinned to the Playwright build matching the base-image chromium. */
const PLAYWRIGHT_CORE = "playwright-core@1.49.1";
/** The system chromium present in the Daytona base image (proven by spike). */
const SYSTEM_CHROMIUM = "/usr/bin/chromium";

/**
 * In-sandbox browser script (Node + playwright-core). Renders the REAL JS app
 * (curl only sees the SPA shell), then applies the SAME `PATTERNS` as the
 * kernel extractor over the rendered DOM + visible text, and prints ONLY a
 * marker-wrapped typed result. The full HTML / screenshot stay in the sandbox
 * and die on teardown (threat-model C4: reflected HTML never returns).
 *
 * `loggedIn` keeps fixture parity (fixture-auth requires a parsed plan) while
 * also accepting a service-specific positive marker on a real page (where the
 * `data-sp-plan` attribute is absent). A login wall hard-disqualifies either.
 */
function browserScript(): string {
  return `
const { chromium } = require('playwright-core');
const PATTERNS = ${JSON.stringify(PATTERNS)};
const MARKER = '${MARKER}';
const service = process.env.SP_SERVICE || '';
const url = process.env.SP_URL || '';
const testMode = process.env.SP_TEST === '1';

function fm(hay, p) { const m = new RegExp(p, 'i').exec(hay); return m ? (m[1] || m[0]) : ''; }

(async () => {
  let out = { loggedIn:false, plan:'', billingCountryRaw:'', cancelled:false, confidence:0.1, httpStatus:0 };
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: '${SYSTEM_CHROMIUM}',
      headless: true,
      args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    });
    const context = await browser.newContext({
      locale: 'de-DE',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    if (!testMode) {
      let cookies = [];
      try { cookies = JSON.parse(process.env.SP_COOKIES || '[]'); } catch (e) {}
      if (cookies.length) await context.addCookies(cookies);
    }
    const page = await context.newPage();
    if (testMode) {
      await page.setContent(process.env.ACCOUNT_FIXTURE || '', { waitUntil: 'load' });
    } else {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 35000 });
      out.httpStatus = resp ? resp.status() : 0;
      // settle late client-side renders / redirects to the login wall
      await page.waitForTimeout(1500);
    }
    const html = await page.content();
    let text = '';
    try { text = await page.evaluate(() => document.body ? document.body.innerText : ''); } catch (e) {}
    // Screenshot stays sandbox-local — useful evidence, never returned.
    try { await page.screenshot({ path: '/tmp/sp-shot.png' }); } catch (e) {}

    const hay = html + '\\n' + text;
    const plan = fm(hay, PATTERNS.fixturePlan);
    out.plan = plan;
    out.billingCountryRaw = fm(hay, PATTERNS.fixtureCountry);
    const hasFixtureAuth = new RegExp(PATTERNS.fixtureAuth, 'i').test(hay);
    const svcAuth = PATTERNS.auth[service];
    const hasServiceAuth = svcAuth ? new RegExp(svcAuth, 'i').test(hay) : false;
    const hasLoginWall = new RegExp(PATTERNS.loginWall, 'i').test(hay);
    // Fixture path: positive attr + a parsed plan. Real path: a service marker.
    out.loggedIn = !hasLoginWall && ((hasFixtureAuth && plan.length > 0) || hasServiceAuth);
    const svcCancelled = PATTERNS.cancelled[service];
    out.cancelled = out.loggedIn && (
      new RegExp(PATTERNS.fixtureCancelled, 'i').test(hay) ||
      (svcCancelled ? new RegExp(svcCancelled, 'i').test(hay) : false)
    );
    out.confidence = out.loggedIn ? (hasFixtureAuth ? 0.9 : 0.55) : 0.1;
  } catch (e) {
    // NEVER echo page content on error — strip any URL (an auth-redirect can
    // carry the session token in a query param) BEFORE truncating, so a partial
    // token can't survive the slice into the audit (sec-review H-1).
    out.error = String((e && e.message) || e)
      .replace(/https?:\\/\\/[^\\s)'"]+/g, '[url]')
      .slice(0, 160);
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
  console.log(MARKER + JSON.stringify(out) + MARKER);
})();
`;
}

function parseMarker(stdout: string): {
  loggedIn: boolean;
  plan: string;
  billingCountryRaw: string;
  cancelled: boolean;
  confidence: number;
  httpStatus?: number;
  error?: string;
} {
  const start = stdout.indexOf(MARKER);
  const end = stdout.indexOf(MARKER, start + MARKER.length);
  if (start === -1 || end === -1) {
    // NEVER echo stdout — it may hold reflected page content (threat-model C4).
    throw new Error("browser sandbox produced no result marker");
  }
  return JSON.parse(stdout.slice(start + MARKER.length, end));
}

/**
 * READ-ONLY login proof inside ONE ephemeral Daytona sandbox, via a REAL
 * headless browser (renders the JS app the curl path can't see). No
 * click/change/cancel/pay — a single authenticated GET render.
 *
 * The session cookie is injected into the browser context from a per-command
 * env var (`SP_COOKIES`, never inlined into the command string), is redacted in
 * the audit, and dies with the sandbox on teardown.
 */
export async function runBrowserRead(
  input: BrowserReadInput,
): Promise<VerifySandboxOutput> {
  const { service, accountUrl, cookies, rawToken, proxy, accountFixtureHtml, network } =
    input;
  const px = proxyShell(proxy);
  const testMode = !!accountFixtureHtml && cookies.length === 0;

  const cmdEnv: Record<string, string> = {
    ...px.env,
    SP_SERVICE: service,
    SP_URL: accountUrl,
    SP_TEST: testMode ? "1" : "0",
    ...(testMode
      ? { ACCOUNT_FIXTURE: accountFixtureHtml ?? "" }
      : { SP_COOKIES: JSON.stringify(cookies) }),
  };

  return withSandbox(
    async (sb): Promise<VerifySandboxOutput> => {
      const steps: ActionStep[] = [];
      const tokenRedacted = redactToken(rawToken);

      // Step 0 — egress proof (best-effort; geo JSON carries no secret).
      let egressIp: string | undefined;
      let egressCountry: string | undefined;
      if (!testMode) {
        try {
          const geo = await runShell(
            sb,
            `curl -s --max-time 20 ${px.flags} https://geo.brdtest.com/mygeo.json`,
            cmdEnv,
            30,
          );
          const j = geo.stdout.slice(geo.stdout.indexOf("{"), geo.stdout.lastIndexOf("}") + 1);
          const parsed = JSON.parse(j) as { ip?: string; country?: string; geo?: { country?: string } };
          egressIp = parsed.ip;
          egressCountry = (parsed.country ?? parsed.geo?.country ?? "").toUpperCase();
        } catch {
          /* egress is best-effort evidence */
        }
      }
      steps.push({
        step: "egress",
        detail: testMode
          ? "Test mode — no network egress"
          : egressCountry
            ? `Egress ${egressCountry}${egressIp ? ` (${egressIp})` : ""} via ${proxy.mode}`
            : `Egress check inconclusive via ${proxy.mode}`,
      });

      // Step 1 — install playwright-core (system chromium is already present).
      // `--ignore-scripts`: no postinstall hooks run in the sandbox that will
      // later hold the cookie (supply-chain hardening, sec-review C-2). No
      // cookie is in env at this step regardless.
      await runShell(
        sb,
        `cd /tmp && npm init -y >/dev/null 2>&1 && npm i --ignore-scripts ${PLAYWRIGHT_CORE} >/dev/null 2>&1; echo done`,
        {},
        300,
      );
      // Step 2 — render the account page in a real browser; only a marker returns.
      const run = await runShell(
        sb,
        `cd /tmp && cat > br.js <<'SPEOF'\n${browserScript()}\nSPEOF\nnode br.js`,
        cmdEnv,
        180,
      );
      const fields = parseMarker(run.stdout);
      steps.push({
        step: "read",
        detail: `Account page rendered in headless browser${fields.httpStatus ? ` (HTTP ${fields.httpStatus})` : ""}`,
      });
      if (fields.error) {
        steps.push({ step: "note", detail: `Browser note: ${fields.error}` });
      }
      steps.push({
        step: "redact",
        detail: `Session token isolated in sandbox: ${tokenRedacted}`,
      });

      return {
        sandboxId: sb.id,
        egressIp,
        egressCountry,
        httpStatus: fields.httpStatus,
        loggedIn: fields.loggedIn,
        plan: fields.plan,
        billingCountryRaw: fields.billingCountryRaw,
        cancelled: fields.cancelled,
        confidence: fields.confidence,
        tokenRedacted,
        steps,
      };
    },
    { SP_SERVICE: service },
    network,
  );
}
