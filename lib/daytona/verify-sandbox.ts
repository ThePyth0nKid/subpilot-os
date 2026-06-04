import type { ProxyConfig } from "@/lib/providers";
import {
  runJs,
  runShell,
  withSandbox,
  type SandboxNetwork,
} from "@/lib/daytona/runner";
import { proxyShell } from "@/lib/daytona/proxy-shell";
import { redactToken } from "@/lib/verify/redact";
import { PATTERNS, type Target } from "@/lib/agents/login-read/parse";
import type { ActionStep } from "@/lib/daytona/action-sandbox";

export interface VerifySandboxInput {
  readonly service: Target;
  readonly targetCountry: string;
  readonly sessionToken: string; // real cookie OR a "test:"-prefixed fixture token
  readonly accountUrl: string;
  readonly proxy: ProxyConfig;
  readonly accountFixtureHtml?: string; // deterministic HTML for test tokens
  readonly network?: SandboxNetwork; // egress allowlist (real-cookie runs)
}

export interface VerifySandboxOutput {
  readonly sandboxId: string;
  readonly egressIp?: string;
  readonly egressCountry?: string;
  readonly httpStatus?: number;
  readonly loggedIn: boolean;
  readonly plan: string;
  readonly billingCountryRaw: string; // small extracted string; kernel normalizes
  readonly cancelled: boolean; // Stage 2: positive cancellation marker present
  readonly confidence: number;
  readonly tokenRedacted: string;
  readonly steps: readonly ActionStep[];
}

const MARKER = "__VR__";

/** Pull the first {...} JSON object out of possibly-noisy stdout. */
function firstJsonObject(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start !== -1 && end > start ? s.slice(start, end + 1) : "";
}

/**
 * In-sandbox extraction script (Node). Reads the account HTML from a
 * sandbox-local FILE — the raw HTML (which can reflect the user's email /
 * CSRF / refreshed cookies) NEVER returns to the kernel. Applies the SAME
 * `PATTERNS` as `extractAccountFields` (kernel, unit-tested) so the live path
 * and its test agree, and prints ONLY a marker-wrapped typed result.
 */
function extractScript(): string {
  return `
const fs = require('fs');
const PATTERNS = ${JSON.stringify(PATTERNS)};
let html = '';
try { html = fs.readFileSync('/tmp/sp-account.html', 'utf8'); } catch (e) {}
const service = process.env.SP_SERVICE || '';
const fm = (p) => { const m = new RegExp(p, 'i').exec(html); return m ? (m[1] || m[0]) : ''; };
const plan = fm(PATTERNS.fixturePlan);
const billingCountryRaw = fm(PATTERNS.fixtureCountry);
const hasFixtureAuth = new RegExp(PATTERNS.fixtureAuth, 'i').test(html);
const svc = PATTERNS.auth[service];
const hasServiceAuth = svc ? new RegExp(svc, 'i').test(html) : false;
const hasLoginWall = new RegExp(PATTERNS.loginWall, 'i').test(html);
const loggedIn = (hasFixtureAuth || hasServiceAuth) && !hasLoginWall && plan.length > 0;
const svcCancelled = PATTERNS.cancelled[service];
const cancelled = loggedIn && (new RegExp(PATTERNS.fixtureCancelled, 'i').test(html) || (svcCancelled ? new RegExp(svcCancelled, 'i').test(html) : false));
const confidence = loggedIn ? (hasFixtureAuth ? 0.9 : 0.6) : 0.1;
console.log('${MARKER}' + JSON.stringify({ loggedIn, plan, billingCountryRaw, cancelled, confidence }) + '${MARKER}');
`;
}

function parseMarker(stdout: string): {
  loggedIn: boolean;
  plan: string;
  billingCountryRaw: string;
  cancelled: boolean;
  confidence: number;
} {
  const start = stdout.indexOf(MARKER);
  const end = stdout.indexOf(MARKER, start + MARKER.length);
  if (start === -1 || end === -1) {
    // NEVER echo stdout here — it may hold reflected HTML (threat-model C4).
    throw new Error("verify sandbox produced no result marker");
  }
  return JSON.parse(stdout.slice(start + MARKER.length, end));
}

/**
 * READ-ONLY login proof inside ONE ephemeral Daytona sandbox. No
 * click/change/cancel/pay — `curl` GETs only.
 *
 * Flow: (0) egress proof via geo.brdtest.com; (1) authenticated GET of the
 * account page → a sandbox-local FILE (cookie referenced ONLY as the
 * shell-expanded `$SP_COOKIE` env var, never concatenated into the command
 * string); (2) in-sandbox typed extraction → only a marker-wrapped result
 * leaves the sandbox. The session token enters via per-command env, is redacted
 * in the audit, and dies with the sandbox on teardown.
 */
export async function runVerifyInSandbox(
  input: VerifySandboxInput,
): Promise<VerifySandboxOutput> {
  const {
    service,
    sessionToken,
    accountUrl,
    proxy,
    accountFixtureHtml,
    network,
  } = input;
  const px = proxyShell(proxy);
  const testMode = sessionToken.startsWith("test:");
  // Seed the sandbox process env (read by the runJs extraction step).
  const createEnv: Record<string, string> = {
    SP_SERVICE: service,
    ...(testMode && accountFixtureHtml ? { ACCOUNT_FIXTURE: accountFixtureHtml } : {}),
  };
  // Per-command env for the curl steps — proxy creds + cookie + target URL,
  // referenced only as $VARS inside double quotes (never inlined).
  const cmdEnv: Record<string, string> = {
    ...px.env,
    SP_COOKIE: sessionToken,
    ACCOUNT_URL: accountUrl,
  };

  return withSandbox(
    async (sb): Promise<VerifySandboxOutput> => {
      const steps: ActionStep[] = [];
      const tokenRedacted = redactToken(sessionToken);

      // Step 0 — egress proof (best-effort; geo JSON carries no secret).
      let egressIp: string | undefined;
      let egressCountry: string | undefined;
      try {
        const geo = await runShell(
          sb,
          `curl -s --max-time 20 ${px.flags} https://geo.brdtest.com/mygeo.json`,
          cmdEnv,
          30,
        );
        const parsed = JSON.parse(firstJsonObject(geo.stdout)) as {
          ip?: string;
          country?: string;
          geo?: { country?: string };
        };
        egressIp = parsed.ip;
        egressCountry = (parsed.country ?? parsed.geo?.country ?? "").toUpperCase();
      } catch {
        /* egress is best-effort evidence */
      }
      steps.push({
        step: "egress",
        detail: egressCountry
          ? `Egress ${egressCountry}${egressIp ? ` (${egressIp})` : ""} via ${proxy.mode}`
          : `Egress check inconclusive via ${proxy.mode}`,
      });

      // Step 1 — get the account HTML into a sandbox-local file (never stdout).
      let httpStatus: number | undefined;
      if (testMode) {
        // Deterministic: materialize the fixture into the file; no network, no cookie.
        await runJs(
          sb,
          `const fs=require('fs');fs.writeFileSync('/tmp/sp-account.html',process.env.ACCOUNT_FIXTURE||'');console.log('ok');`,
        );
        steps.push({ step: "read", detail: "Loaded deterministic account fixture (test mode)" });
      } else {
        const r = await runShell(
          sb,
          `curl -sL --max-time 25 ${px.flags} -b "$SP_COOKIE" -A "Mozilla/5.0 (SubPilotVerify)" -o /tmp/sp-account.html -w "%{http_code}" "$ACCOUNT_URL"`,
          cmdEnv,
          35,
        );
        httpStatus = Number.parseInt(r.stdout.trim(), 10) || undefined;
        steps.push({
          step: "read",
          detail: `Account page fetched into sandbox-local file${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
        });
      }

      // Step 2 — in-sandbox typed extraction; only the marker result returns.
      const extract = await runJs(sb, extractScript());
      const fields = parseMarker(extract.stdout);
      steps.push({
        step: "redact",
        detail: `Session token isolated in sandbox: ${tokenRedacted}`,
      });

      return {
        sandboxId: sb.id,
        egressIp,
        egressCountry,
        httpStatus,
        loggedIn: fields.loggedIn,
        plan: fields.plan,
        billingCountryRaw: fields.billingCountryRaw,
        cancelled: fields.cancelled,
        confidence: fields.confidence,
        tokenRedacted,
        steps,
      };
    },
    createEnv,
    network,
  );
}
