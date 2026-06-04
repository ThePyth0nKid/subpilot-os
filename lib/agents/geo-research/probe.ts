import type { ProxyConfig } from "@/lib/providers";
import type { OptimizableService } from "@/lib/domain/subscription";
import { runShell, type Sandbox } from "@/lib/daytona/runner";
import { proxyShell } from "@/lib/daytona/proxy-shell";
import { pricingUrl } from "./sources";

type Target = OptimizableService;

export interface ProbeEvidence {
  readonly url: string;
  readonly html: string; // truncated in-country page text
}

export interface ProbeResult {
  readonly ok: boolean; // sandbox executed + egress check returned a country
  readonly proxyMode: string; // "brightdata" | "mock"
  readonly egressIp?: string;
  readonly egressCountry?: string; // ISO-2 the request actually exited from
  readonly inCountry?: boolean; // egressCountry === requested country
  readonly ms?: number;
  readonly evidence?: ProbeEvidence;
  readonly error?: string;
}

/** Pull the first {...} JSON object out of possibly-noisy curl stdout. */
function firstJsonObject(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start !== -1 && end > start ? s.slice(start, end + 1) : "";
}

const EVIDENCE_MAX = 6000;

/**
 * GEO PROBE — runs INSIDE the Daytona sandbox. Step 1 proves real in-country
 * egress (geo.brdtest.com), step 2 fetches the regional pricing page through
 * the same country IP as evidence. Only the proxy credential enters the
 * sandbox; LLM/Tavily keys never do.
 */
export async function runGeoProbe(
  sandbox: Sandbox,
  service: Target,
  country: string,
  proxy: ProxyConfig,
): Promise<ProbeResult> {
  const started = Date.now();
  const px = proxyShell(proxy);
  const url = pricingUrl(service, country);
  // Secrets + target URL travel as env vars, never interpolated into the shell.
  const env = { ...px.env, TARGET_URL: url };

  let egressIp: string | undefined;
  let egressCountry: string | undefined;
  let ok = false;
  let error: string | undefined;

  try {
    const geoCmd = `curl -s --max-time 20 ${px.flags} https://geo.brdtest.com/mygeo.json`;
    const out = await runShell(sandbox, geoCmd, env, 30);
    const parsed = JSON.parse(firstJsonObject(out.stdout)) as {
      ip?: string;
      country?: string;
      geo?: { country?: string };
    };
    egressIp = parsed.ip;
    egressCountry = (parsed.country ?? parsed.geo?.country ?? "").toUpperCase();
    ok = Boolean(egressCountry);
  } catch (e) {
    error = e instanceof Error ? e.message : "egress check failed";
  }

  let evidence: ProbeEvidence | undefined;
  try {
    const fetchCmd = `curl -sL --max-time 25 ${px.flags} -A "Mozilla/5.0 (SubPilotProbe)" "$TARGET_URL"`;
    const out = await runShell(sandbox, fetchCmd, env, 35);
    const html = out.stdout.slice(0, EVIDENCE_MAX).trim();
    if (html) evidence = { url, html };
  } catch {
    /* evidence is best-effort; Tavily covers extraction */
  }

  return {
    ok,
    proxyMode: proxy.mode,
    egressIp,
    egressCountry,
    inCountry: egressCountry
      ? egressCountry === country.toUpperCase()
      : undefined,
    ms: Date.now() - started,
    evidence,
    error,
  };
}
