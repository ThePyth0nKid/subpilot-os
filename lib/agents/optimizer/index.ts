import type { GeoPriceResult } from "@/lib/domain/geo-price";
import type { PreferenceProfile } from "@/lib/domain/preference";
import {
  OptimizationResultSchema,
  type OptimizationResult,
  type PaymentPath,
  type Recommendation,
} from "@/lib/domain/recommendation";
import type { Subscription } from "@/lib/domain/subscription";
import { emitter, type OnEvent } from "@/lib/agents/emit";
import { assessOption } from "@/lib/agents/constraint";

export interface OptimizeArgs {
  readonly profiles: ReadonlyMap<string, PreferenceProfile>;
  readonly runId?: string;
  readonly onEvent?: OnEvent;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function recommend(
  sub: Readonly<Subscription>,
  options: readonly GeoPriceResult[],
  profile: Readonly<PreferenceProfile>,
): Recommendation {
  const currentMonthlyEUR = round2(sub.currentMonthly.monthlyEUR);
  const assessed = options
    .map((geo) => assessOption(sub, geo, profile))
    .sort((a, b) => a.geo.normalized.monthlyEUR - b.geo.normalized.monthlyEUR);
  const viableOpts = assessed.filter((a) => a.viable);
  const best = viableOpts[0];

  const cheaperThanNow =
    best && best.geo.normalized.monthlyEUR < currentMonthlyEUR - 0.01;

  const chosen = cheaperThanNow ? best.geo : null;
  const monthlySavingsEUR = chosen
    ? round2(currentMonthlyEUR - chosen.normalized.monthlyEUR)
    : 0;
  const paymentPath: PaymentPath = chosen
    ? chosen.country === sub.detectedCountry
      ? "direct_card"
      : "bitrefill_giftcard"
    : "none";

  const rejected = assessed
    .filter((a) => a.geo !== chosen)
    .map((a) => a.geo);

  return {
    subscriptionId: sub.id,
    service: sub.service,
    currentMonthlyEUR,
    chosen,
    monthlySavingsEUR,
    annualSavingsEUR: round2(monthlySavingsEUR * 12),
    paymentPath,
    tradeoffs: chosen
      ? (best?.tradeoffs ?? [])
      : ["Already on the cheapest viable region — keep as-is"],
    risk: (best ?? assessed[0]).risk,
    viable: Boolean(cheaperThanNow),
    rejectedAlternatives: rejected,
  };
}

/**
 * OPTIMIZER AGENT — for each subscription pick the cheapest viable region
 * (Constraint-filtered) and compute the savings. Aggregates portfolio totals.
 */
export function optimize(
  subs: readonly Subscription[],
  geoResults: readonly GeoPriceResult[],
  { profiles, runId = "local", onEvent }: OptimizeArgs,
): OptimizationResult {
  const emit = emitter("optimizer", runId, onEvent);
  emit("started", "Picking cheapest viable region per subscription…");

  const recommendations = subs.map((sub) => {
    const options = geoResults.filter((g) => g.service === sub.service);
    const profile =
      profiles.get(sub.id) ??
      ({
        subscriptionId: sub.id,
        usage: "weekly",
        householdSize: 1,
        needs4K: false,
        englishOnlyOk: true,
        localContentImportant: false,
        keep: "nice_to_have",
        maxRisk: "medium",
      } satisfies PreferenceProfile);
    return recommend(sub, options, profile);
  });

  const totalCurrentMonthlyEUR = round2(
    recommendations.reduce((s, r) => s + r.currentMonthlyEUR, 0),
  );
  const totalMonthlySavingsEUR = round2(
    recommendations.reduce((s, r) => s + r.monthlySavingsEUR, 0),
  );
  const result = OptimizationResultSchema.parse({
    recommendations,
    totalCurrentMonthlyEUR,
    totalOptimizedMonthlyEUR: round2(
      totalCurrentMonthlyEUR - totalMonthlySavingsEUR,
    ),
    totalMonthlySavingsEUR,
  });

  const switches = recommendations.filter((r) => r.viable).length;
  emit(
    "completed",
    `Optimized ${recommendations.length} subscriptions — ${switches} region switches, €${totalMonthlySavingsEUR.toFixed(2)}/mo saved`,
    { payload: result },
  );
  return result;
}
