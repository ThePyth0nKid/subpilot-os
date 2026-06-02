import type { ProxyConfig } from "@/lib/providers";

export interface ProbeResult {
  readonly ok: boolean;
  readonly egressIp?: string;
  readonly ms?: number;
  readonly proxyMode: string;
  readonly error?: string;
}

const MARKER = "__PROBE__";

/**
 * JS executed INSIDE the Daytona sandbox: proves real, isolated network egress
 * per country sandbox (the on-stage fan-out signal). The regional price itself
 * is extracted in the kernel — API keys never enter the sandbox.
 */
export function buildProbeCode(
  service: string,
  country: string,
  proxy: ProxyConfig,
): string {
  const ctx = JSON.stringify({
    service,
    country,
    proxyMode: proxy.mode,
    proxyHost: proxy.host,
  });
  return `(async () => {
  const ctx = ${ctx};
  const started = Date.now();
  const out = { proxyMode: ctx.proxyMode };
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const j = await r.json();
    out.ok = true;
    out.egressIp = j.ip;
    out.ms = Date.now() - started;
  } catch (e) {
    out.ok = false;
    out.error = String(e && e.message ? e.message : e);
    out.ms = Date.now() - started;
  }
  console.log('${MARKER}' + JSON.stringify(out) + '${MARKER}');
})();`;
}

/** Extract the probe JSON from noisy sandbox stdout (npm notices etc.). */
export function parseProbe(stdout: string, proxyMode: string): ProbeResult {
  const start = stdout.indexOf(MARKER);
  const end = stdout.indexOf(MARKER, start + MARKER.length);
  if (start === -1 || end === -1) {
    return { ok: false, proxyMode, error: "no probe marker in stdout" };
  }
  try {
    const json = stdout.slice(start + MARKER.length, end);
    const parsed = JSON.parse(json) as ProbeResult;
    return { ...parsed, proxyMode };
  } catch (e) {
    return { ok: false, proxyMode, error: `parse failed: ${String(e)}` };
  }
}
