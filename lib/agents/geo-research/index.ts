import { toMonthlyEUR } from "@/lib/domain/fx";
import {
  GeoPriceResultSchema,
  type GeoPriceResult,
} from "@/lib/domain/geo-price";
import { formatMoney } from "@/lib/domain/money";
import type { OptimizableService } from "@/lib/domain/subscription";
import { emitter, type OnEvent } from "@/lib/agents/emit";
import { fanOut, withSandbox } from "@/lib/daytona/runner";
import type { LlmClient, ProxyProvider, SearchProvider } from "@/lib/providers";
import { countryInfo } from "./countries";
import { extractPrice } from "./extract";
import { runGeoProbe, type ProbeResult } from "./probe";

export interface GeoDeps {
  readonly search: SearchProvider;
  readonly llm: LlmClient;
  readonly proxy: ProxyProvider;
  readonly runId?: string;
  readonly onEvent?: OnEvent;
  readonly concurrency?: number;
}

type Target = OptimizableService;

/** Boost confidence on confirmed in-country egress; penalize on probe failure. */
function scoreConfidence(probe: ProbeResult | null, base: number): number {
  if (!probe?.ok) return Math.min(base, 0.6);
  if (probe.inCountry) return Math.min(1, base + 0.15);
  return base;
}

/**
 * GEO-RESEARCH AGENT (fan-out unit): one Daytona sandbox proves isolated
 * country egress; the kernel runs Tavily + Haiku to extract the regional price.
 */
export async function researchOne(
  service: Target,
  country: string,
  deps: GeoDeps,
): Promise<GeoPriceResult> {
  const emit = emitter("geo-research", deps.runId ?? "local", deps.onEvent);
  const info = countryInfo(country);
  const proxyCfg = deps.proxy.forCountry(country);

  emit("started", `Spinning up sandbox · ${service} × ${info.name}`, { country });

  let probe: ProbeResult | null = null;
  let sandboxId: string | undefined;
  try {
    probe = await withSandbox(async (sb) => {
      sandboxId = sb.id;
      emit(
        "progress",
        `Sandbox ${sb.id.slice(0, 8)} · routing egress via ${proxyCfg.mode} (${info.name})`,
        { country, sandboxId: sb.id },
      );
      const result = await runGeoProbe(sb, service, country, proxyCfg);
      if (result.egressCountry) {
        emit(
          "progress",
          `Egress confirmed ${result.egressCountry}${result.egressIp ? ` (${result.egressIp})` : ""}${result.inCountry ? " ✓ in-country" : ""}`,
          { country, sandboxId: sb.id },
        );
      }
      return result;
    });
  } catch {
    probe = null;
  }

  const extracted = await extractPrice(service, country, deps, probe?.evidence);
  const price = {
    amountMinor: extracted.monthlyAmountMinor,
    currency: extracted.currency,
  };
  const confidence = scoreConfidence(probe, extracted.confidence);

  const geo = GeoPriceResultSchema.parse({
    service,
    country: country.toUpperCase(),
    planName: extracted.planName,
    price,
    normalized: toMonthlyEUR(price, "monthly"),
    acceptedPaymentMethods: extracted.acceptedPaymentMethods,
    contentNotes: extracted.contentNotes,
    uiLanguages: extracted.uiLanguages,
    sourceUrl: extracted.sourceUrl,
    capturedAt: new Date().toISOString(),
    proxyCountry: probe?.egressCountry || proxyCfg.country,
    confidence,
  } satisfies GeoPriceResult);

  emit(
    "completed",
    `${service} · ${info.name}: ${formatMoney(price)} ≈ €${geo.normalized.monthlyEUR.toFixed(2)}/mo`,
    { country, sandboxId, payload: geo },
  );
  return geo;
}

/** Fan out research over service × country with bounded concurrency. */
export async function researchMatrix(
  services: readonly Target[],
  countries: readonly string[],
  deps: GeoDeps,
): Promise<readonly GeoPriceResult[]> {
  const targets = services.flatMap((service) =>
    countries.map((country) => ({ service, country })),
  );
  const results = await fanOut(
    targets,
    ({ service, country }) => researchOne(service, country, deps),
    { concurrency: deps.concurrency ?? 5 },
  );
  return results.filter((r): r is GeoPriceResult => r !== null);
}
