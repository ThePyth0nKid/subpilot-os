import type { ProxyConfig, ProxyProvider } from "./types";

/**
 * Pass-through proxy: returns descriptive credentials but no real egress
 * re-routing. The sandbox still performs a real fetch — just from its own IP.
 * Swap in BrightDataProxy (same interface) to get true country IPs.
 */
export class MockProxy implements ProxyProvider {
  forCountry(country: string): ProxyConfig {
    const cc = country.toLowerCase();
    return {
      country: country.toUpperCase(),
      host: "direct",
      port: 0,
      username: `mock-residential-${cc}`,
      password: "mock",
      mode: "mock",
    };
  }
}
