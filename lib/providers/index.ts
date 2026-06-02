import { hasBitrefill, hasBrightData, loadEnv } from "@/lib/env";
import { AnthropicClient } from "./llm/anthropic";
import type { LlmClient } from "./llm/types";
import { BrightDataProxy } from "./proxy/brightdata";
import { MockProxy } from "./proxy/mock";
import type { ProxyProvider } from "./proxy/types";
import { BitrefillPayment } from "./payment/bitrefill";
import { MockPayment } from "./payment/mock";
import type { PaymentProvider } from "./payment/types";
import { MockSearch } from "./search/mock";
import { TavilySearch } from "./search/tavily";
import type { SearchProvider } from "./search/types";

export * from "./llm/types";
export * from "./search/types";
export * from "./proxy/types";
export * from "./payment/types";

export interface Providers {
  readonly llm: LlmClient;
  readonly search: SearchProvider;
  readonly proxy: ProxyProvider;
  readonly payment: PaymentProvider;
  readonly modes: Readonly<{
    search: "tavily" | "mock";
    proxy: "brightdata" | "mock";
    payment: "bitrefill" | "mock";
  }>;
}

let cached: Providers | null = null;

/**
 * Factory that wires real providers where keys exist, mocks otherwise — so the
 * pipeline runs on real Daytona + Anthropic + Tavily today, swapping Bright Data
 * + Bitrefill in later with zero call-site changes.
 */
export function getProviders(): Providers {
  if (cached) return cached;
  const env = loadEnv();

  const useBrightData = hasBrightData(env);
  const useBitrefill = hasBitrefill(env);

  cached = {
    llm: new AnthropicClient(env.ANTHROPIC_API_KEY),
    search: env.TAVILY_API_KEY
      ? new TavilySearch(env.TAVILY_API_KEY)
      : new MockSearch(),
    proxy: useBrightData
      ? new BrightDataProxy({
          host: env.BRIGHTDATA_HOST!,
          port: env.BRIGHTDATA_PORT!,
          username: env.BRIGHTDATA_USERNAME!,
          password: env.BRIGHTDATA_PASSWORD!,
        })
      : new MockProxy(),
    payment: useBitrefill
      ? new BitrefillPayment({
          apiKey: env.BITREFILL_API_KEY!,
          apiSecret: env.BITREFILL_API_SECRET!,
        })
      : new MockPayment(),
    modes: {
      search: env.TAVILY_API_KEY ? "tavily" : "mock",
      proxy: useBrightData ? "brightdata" : "mock",
      payment: useBitrefill ? "bitrefill" : "mock",
    },
  };
  return cached;
}
