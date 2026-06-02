export interface ProxyConfig {
  readonly country: string; // ISO-2
  readonly host: string;
  readonly port: number;
  readonly username: string; // Bright Data encodes the country in the username
  readonly password: string;
  readonly mode: "mock" | "brightdata";
}

/** Builds country-targeted proxy credentials for use inside a sandbox. */
export interface ProxyProvider {
  forCountry(country: string): ProxyConfig;
}
