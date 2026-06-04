import type { ProxyConfig } from "@/lib/providers";

export interface ProxyShell {
  readonly flags: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Bright Data proxy → curl flags that reference ENV VARS (never inline creds).
 *
 * Credentials are passed structurally via the per-command env and expanded
 * inside double quotes, so a password containing shell metacharacters can't
 * inject (the shell does not re-scan an expanded value). For an `https://`
 * target curl tunnels through the proxy with `CONNECT` and terminates TLS
 * itself — the proxy sees only ciphertext, never the cookie (threat-model C4).
 * Mock / direct mode → no proxy flags.
 *
 * Single source of truth shared by the geo-research probe and the login-read
 * probe so the CONNECT-tunnel invariant lives in exactly one place.
 */
export function proxyShell(proxy: ProxyConfig): ProxyShell {
  if (proxy.mode !== "brightdata" || !proxy.host || proxy.host === "direct") {
    return { flags: "", env: {} };
  }
  return {
    flags: `--proxy "http://$BD_HOST:$BD_PORT" --proxy-user "$BD_USER:$BD_PASS"`,
    env: {
      BD_HOST: proxy.host,
      BD_PORT: String(proxy.port),
      BD_USER: proxy.username,
      BD_PASS: proxy.password,
    },
  };
}
