# SubPilot OS — Architecture & Data Contracts

> Principles: **immutability** (all fields `readonly`, new objects not mutation), many small files, validate at every boundary (Zod).

## Model routing

| Task | Model | Why |
|---|---|---|
| Geo-price extraction, CSV/merchant normalization (workers, frequent) | **Haiku 4.5** | cheap, high-frequency |
| Interview, Constraint, Optimizer, Orchestration | **Sonnet 4.6** | best reasoning/coding |

Use **prompt caching** (system prompt + tool defs) on all Anthropic calls.

## Agent topology

```
        ORCHESTRATOR (OS kernel / state machine)
        ingest -> interview -> research -> optimize -> act -> report
   |---------|-------------------|---------------------------|
   v         v                   v                           v
 INGEST    INTERVIEW       GEO-RESEARCH (fan-out)        ACTION (fan-out)
 CSV->subs   mini Qs         1 Daytona sandbox per          gift-card via Bitrefill,
            (en-only ok?)    sub x country, country IP      create account, cancel old
                                  |
                                  v
                    CONSTRAINT -> OPTIMIZER -> REPORT
                    viable?       cheapest    savings + audit
                    risk score    viable
```

**Why Daytona:** untrusted browser automation + geo network egress + parallel fan-out + credential isolation (card secrets only inside the action sandbox). Daytona = isolation; the proxy provider gives the country IP (Daytona has no native geo-VPN).

## Core domain types (`lib/domain/`)

```ts
export interface Money { readonly amountMinor: number; readonly currency: string; } // ISO-4217
export interface NormalizedPrice { readonly monthlyEUR: number; readonly fxRateUsed: number; readonly fxAsOf: string; }

export type ServiceSlug = 'netflix'|'spotify'|'youtube_premium'|'disney_plus'|'chatgpt'|'unknown';
export type BillingInterval = 'monthly'|'yearly'|'quarterly'|'unknown';

export interface Subscription {
  readonly id: string; readonly service: ServiceSlug;
  readonly merchantRaw: string; readonly merchantNormalized: string;
  readonly currentPrice: Money; readonly interval: BillingInterval;
  readonly currentMonthly: NormalizedPrice; readonly detectedCountry: string;
  readonly currentPlan?: string; readonly confidence: number;
  readonly sourceTransactionIds: readonly string[];
}

export interface PreferenceProfile {
  readonly subscriptionId: string;
  readonly usage: 'daily'|'weekly'|'rarely'|'never';
  readonly householdSize: number; readonly needs4K: boolean;
  readonly englishOnlyOk: boolean; readonly localContentImportant: boolean;
  readonly keep: 'must_keep'|'nice_to_have'|'cancel_candidate';
  readonly maxRisk: 'low'|'medium'|'high';
}

export interface GeoPriceResult {
  readonly service: ServiceSlug; readonly country: string; readonly planName: string;
  readonly price: Money; readonly normalized: NormalizedPrice;
  readonly acceptedPaymentMethods: readonly string[];
  readonly contentNotes: string; readonly uiLanguages: readonly string[];
  readonly sourceUrl: string; readonly capturedAt: string;
  readonly proxyCountry: string; readonly screenshotPath?: string; readonly confidence: number;
}

export interface RiskAssessment {
  readonly level: 'low'|'medium'|'high';
  readonly tosViolationLikelihood: number; readonly accountBanRisk: number;
  readonly reasons: readonly string[]; readonly mitigations: readonly string[];
}

export interface Recommendation {
  readonly subscriptionId: string; readonly service: ServiceSlug;
  readonly currentMonthlyEUR: number; readonly chosen: GeoPriceResult | null;
  readonly monthlySavingsEUR: number; readonly annualSavingsEUR: number;
  readonly paymentPath: 'bitrefill_giftcard'|'direct_card'|'none';
  readonly tradeoffs: readonly string[]; readonly risk: RiskAssessment;
  readonly viable: boolean; readonly rejectedAlternatives: readonly GeoPriceResult[];
}

export interface OptimizationResult {
  readonly recommendations: readonly Recommendation[];
  readonly totalCurrentMonthlyEUR: number; readonly totalOptimizedMonthlyEUR: number;
  readonly totalMonthlySavingsEUR: number;
}

export interface ActionResult {
  readonly subscriptionId: string; readonly status: 'dry_run'|'executed'|'failed'|'skipped';
  readonly dryRun: boolean; readonly giftCardSku?: string; readonly receiptRef?: string;
  readonly newAccountRegion?: string; readonly oldSubscriptionCancelled: boolean;
  readonly audit: ReadonlyArray<{ at: string; step: string; detail: string }>; readonly error?: string;
}
```

## Orchestrator state machine (`lib/orchestrator/`)

```
IDLE -> INGESTING -> INTERVIEWING -> RESEARCHING(fan-out) -> CONSTRAINING
     -> OPTIMIZING -> AWAITING_CONSENT -> ACTING(fan-out) -> REPORTING -> DONE
(any state -> ERROR; ERROR keeps partials + allows resume)
```

State is persisted and drives a live **SSE event feed** (`AgentEvent`) so the UI shows sandboxes spinning up per country — the on-stage wow moment.

## Provider interfaces (`lib/providers/`) — swappable (real ↔ mock)

- `ProxyProvider.forCountry(country)` → Bright Data creds (mock returns a pass-through).
- `SearchProvider.search(query, {country})` → Tavily (discovery + geo price fallback).
- `PaymentProvider.quote/purchase(order, dryRun)` → Bitrefill (mock returns a fake receipt).
- `LlmClient.complete({model, system, messages, tools})` → Anthropic wrapper (caching + routing).

This lets the whole pipeline run on **real Daytona + Anthropic + Tavily** with **mock Bright Data + Bitrefill** today, swapping in the real providers later with zero call-site changes.
