import { assertNoPII } from "@/lib/anonymize";
import { toMonthlyEUR } from "@/lib/domain/fx";
import {
  OPTIMIZABLE_SERVICES,
  SubscriptionSchema,
  type ServiceSlug,
  type Subscription,
} from "@/lib/domain/subscription";
import type { LlmClient } from "@/lib/providers";
import { emitter, type OnEvent } from "@/lib/agents/emit";
import type { Classification } from "./classify";
import { classifyCandidates } from "./classify";
import { clusterRecurring, type RecurringCandidate } from "./cluster";
import { parseCsv } from "./parse";

export interface IngestArgs {
  readonly llm: LlmClient;
  readonly runId?: string;
  readonly onEvent?: OnEvent;
  /** Optional explicit account-holder names to redact (server-side, from env). */
  readonly holderNames?: readonly string[];
}

function toSubscription(
  c: RecurringCandidate,
  cls: Classification | undefined,
): Subscription {
  const service: ServiceSlug = cls?.service ?? "unknown";
  const kind = cls?.kind ?? "subscription";
  const interval = cls?.interval ?? "monthly";
  const currentPrice = {
    amountMinor: c.monthlyAmountMinor,
    currency: c.currency,
  };
  // Only genuine fixed-price subscriptions are geo-optimization targets — a
  // P2P transfer that costs as much as Netflix, or metered API spend that the
  // classifier maps onto a service brand, must never enter the switch flow.
  const optimizable =
    kind === "subscription" &&
    !c.variableAmount &&
    (OPTIMIZABLE_SERVICES as readonly ServiceSlug[]).includes(service);
  return SubscriptionSchema.parse({
    id: c.id,
    service,
    merchantRaw: c.merchantRaw,
    merchantNormalized: cls?.merchantNormalized ?? c.merchantKey,
    currentPrice,
    interval,
    currentMonthly: toMonthlyEUR(currentPrice, interval),
    detectedCountry: cls?.detectedCountry ?? "DE",
    currentPlan: cls?.currentPlan,
    confidence: cls?.confidence ?? 0.3,
    sourceTransactionIds: c.sourceTransactionIds,
    optimizable,
    kind,
    variableAmount: c.variableAmount,
  });
}

/**
 * INGEST AGENT — deterministic parse + recurrence clustering, then Haiku
 * classification. Produces the full set of detected subscriptions; only those
 * flagged `optimizable` flow into geo-research.
 */
export async function ingest(
  rawCsv: string,
  { llm, runId = "local", onEvent, holderNames }: IngestArgs,
): Promise<readonly Subscription[]> {
  const emit = emitter("ingest", runId, onEvent);
  emit("started", "Parsing bank statement…");

  const txs = parseCsv(rawCsv, { holderNames });
  // Fail-closed: no PII may survive projection+redaction into the pipeline.
  assertNoPII(txs);
  const candidates = clusterRecurring(txs);
  emit(
    "progress",
    `Scanned ${txs.length} transactions → ${candidates.length} recurring charges`,
  );

  const classMap = await classifyCandidates(candidates, llm);
  const subscriptions = candidates.map((c, i) => toSubscription(c, classMap.get(i)));

  // Backstop before anything reaches the SSE payload / DB snapshot.
  assertNoPII(subscriptions);

  const optimizable = subscriptions.filter((s) => s.optimizable);
  const subs = subscriptions.filter((s) => s.kind === "subscription");
  emit(
    "completed",
    `Detected ${subs.length} subscriptions (${optimizable.length} optimizable) + ${subscriptions.length - subs.length} other recurring charges`,
    { payload: subscriptions },
  );

  // Optimizable first, then real subscriptions, then other recurring spend —
  // each tier by monthly cost.
  const tier = (s: Subscription): number =>
    s.optimizable ? 0 : s.kind === "subscription" ? 1 : 2;
  return [...subscriptions].sort((a, b) => {
    if (tier(a) !== tier(b)) return tier(a) - tier(b);
    return b.currentMonthly.monthlyEUR - a.currentMonthly.monthlyEUR;
  });
}
