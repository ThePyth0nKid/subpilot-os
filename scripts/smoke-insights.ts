import { analyzeSubscriptions } from "@/lib/agents/insights";
import { SubscriptionSchema, type Subscription } from "@/lib/domain/subscription";
import type { SpendCategory } from "@/lib/domain/insight";
import type { Transaction } from "@/lib/domain/transaction";
import { toMonthlyEUR } from "@/lib/domain/fx";

/**
 * PURE, zero-env gate for PR-A1 (insights engine). Builds synthetic classified
 * subscriptions + transactions and verifies the four risk-free detectors:
 * duplicate, category overlap, cost escalation, and zombie — plus that p2p/
 * retail charges never produce findings.
 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-insights] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-insights] ok: ${msg}`);
}

let n = 0;
function sub(opts: {
  merchant: string;
  monthlyEUR: number;
  category: SpendCategory;
  kind?: Subscription["kind"];
  service?: string;
  txIds?: string[];
  variable?: boolean;
}): Subscription {
  const price = { amountMinor: Math.round(opts.monthlyEUR * 100), currency: "EUR" };
  return SubscriptionSchema.parse({
    id: `s-${n++}`,
    service: opts.service ?? "unknown",
    merchantRaw: opts.merchant,
    merchantNormalized: opts.merchant,
    currentPrice: price,
    interval: "monthly",
    currentMonthly: toMonthlyEUR(price, "monthly"),
    detectedCountry: "DE",
    confidence: 0.9,
    sourceTransactionIds: opts.txIds ?? [],
    optimizable: false,
    kind: opts.kind ?? "subscription",
    variableAmount: opts.variable ?? false,
    category: opts.category,
  });
}

const tx = (id: string, date: string, eur: number): Transaction => ({
  id,
  date,
  amount: { amountMinor: Math.round(eur * 100), currency: "EUR" },
  counterparty: "x",
});

// ── 1. OVERLAP — 4 image-gen tools → one high-severity overlap finding ──
{
  const subs = [
    sub({ merchant: "Midjourney", monthlyEUR: 30, category: "image_gen" }),
    sub({ merchant: "Higgsfield", monthlyEUR: 28, category: "image_gen" }),
    sub({ merchant: "Recraft", monthlyEUR: 12, category: "image_gen" }),
    sub({ merchant: "Scenario", monthlyEUR: 13, category: "image_gen" }),
  ];
  const f = analyzeSubscriptions(subs).filter((x) => x.type === "overlap");
  assert(f.length === 1, "1: one overlap finding for the image-gen category");
  assert(f[0].severity === "high", "1: 4 tools → high severity");
  // total 83, keep priciest (30) → savable 53
  assert(Math.round(f[0].estimatedMonthlySavingsEUR) === 53, "1: savable = total minus priciest");
  assert(f[0].affectedSubscriptionIds.length === 4, "1: all four tools referenced");
}

// ── 2. DUPLICATE — same brand at a SIMILAR price → likely double charge ──
{
  const subs = [
    sub({ merchant: "PlayStation", monthlyEUR: 22.99, category: "entertainment", service: "unknown" }),
    sub({ merchant: "PlayStation", monthlyEUR: 19.79, category: "entertainment", service: "unknown" }),
  ];
  const f = analyzeSubscriptions(subs).filter((x) => x.type === "duplicate");
  assert(f.length === 1, "2: similar-price same-brand pair is a duplicate");
  assert(f[0].severity === "high", "2: duplicate is high severity");
  assert(Math.round(f[0].estimatedMonthlySavingsEUR) === 20, "2: cheaper one is the savable estimate");

  // Big price gap = two different products under one brand → NOT a duplicate.
  const apple = [
    sub({ merchant: "Apple", monthlyEUR: 119.99, category: "cloud", service: "apple" }),
    sub({ merchant: "Apple", monthlyEUR: 34.99, category: "cloud", service: "apple" }),
  ];
  assert(
    analyzeSubscriptions(apple).filter((x) => x.type === "duplicate").length === 0,
    "2: a large price gap (120 vs 35) is not flagged as a duplicate",
  );
}

// ── 3. ESCALATION — rising 3-month series → flagged with the latest step-up ──
{
  const ids = ["e1", "e2", "e3"];
  const subs = [
    sub({ merchant: "Notion", monthlyEUR: 135, category: "productivity", txIds: ids }),
  ];
  const txs = [tx("e1", "2026-01-17", 56), tx("e2", "2026-02-17", 92), tx("e3", "2026-03-17", 135)];
  const f = analyzeSubscriptions(subs, txs).filter((x) => x.type === "escalation");
  assert(f.length === 1, "3: rising cost flagged");
  assert(Math.round(f[0].estimatedMonthlySavingsEUR) === 43, "3: latest step-up (135-92) is the estimate");
  // flat series must NOT trigger
  const flat = [tx("f1", "2026-01-01", 10), tx("f2", "2026-02-01", 10), tx("f3", "2026-03-01", 10)];
  const flatSub = [sub({ merchant: "Flat", monthlyEUR: 10, category: "productivity", txIds: ["f1", "f2", "f3"] })];
  assert(
    analyzeSubscriptions(flatSub, flat).filter((x) => x.type === "escalation").length === 0,
    "3: a flat-price subscription is not an escalation",
  );
}

// ── 4. ZOMBIE — long-running entertainment → low-severity usage check ──
{
  const txIds = Array.from({ length: 8 }, (_, i) => `z${i}`);
  const subs = [
    sub({ merchant: "PlayStation", monthlyEUR: 19.79, category: "entertainment", txIds }),
  ];
  const f = analyzeSubscriptions(subs).filter((x) => x.type === "zombie");
  assert(f.length === 1, "4: long-running entertainment flagged as possible zombie");
  assert(f[0].severity === "low", "4: zombie is low severity (review-only)");
}

// ── 5. p2p / retail never produce findings ──
{
  const subs = [
    sub({ merchant: "Miriam Mehlis", monthlyEUR: 300, category: "other", kind: "p2p" }),
    sub({ merchant: "Miriam Mehlis", monthlyEUR: 300, category: "other", kind: "p2p" }),
    sub({ merchant: "Aldi", monthlyEUR: 60, category: "other", kind: "retail" }),
    sub({ merchant: "Aldi", monthlyEUR: 60, category: "other", kind: "retail" }),
  ];
  assert(analyzeSubscriptions(subs).length === 0, "5: p2p/retail produce no findings");
}

// ── 6. sorting — highest estimated savings first ──
{
  const subs = [
    sub({ merchant: "PlayStation", monthlyEUR: 19.79, category: "entertainment", txIds: Array.from({ length: 8 }, (_, i) => `p${i}`) }),
    sub({ merchant: "Midjourney", monthlyEUR: 30, category: "image_gen" }),
    sub({ merchant: "Higgsfield", monthlyEUR: 90, category: "image_gen" }),
  ];
  const all = analyzeSubscriptions(subs);
  assert(all.length >= 2, "6: multiple findings produced");
  assert(
    all[0].estimatedMonthlySavingsEUR >= all[all.length - 1].estimatedMonthlySavingsEUR,
    "6: findings sorted by estimated savings (desc)",
  );
}

console.log("[smoke-insights] ALL PASS");
