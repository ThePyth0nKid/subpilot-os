import type { ProxyConfig, ProxyProvider } from "./types";

export interface BrightDataConfig {
  readonly host: string;
  readonly port: string;
  readonly username: string; // base customer/zone username
  readonly password: string;
}

/**
 * Real Bright Data residential proxy. Country targeting is encoded in the
 * username suffix (`-country-<cc>`). Stub until credentials are provided.
 */
export class BrightDataProxy implements ProxyProvider {
  constructor(private readonly cfg: BrightDataConfig) {}

  forCountry(country: string): ProxyConfig {
    const cc = country.toLowerCase();
    return {
      country: country.toUpperCase(),
      host: this.cfg.host,
      port: Number(this.cfg.port),
      username: `${this.cfg.username}-country-${cc}`,
      password: this.cfg.password,
      mode: "brightdata",
    };
  }
}
