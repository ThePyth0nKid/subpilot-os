import { CATEGORY_LABEL, type Finding } from "@/lib/domain/insight";
import type { Subscription } from "@/lib/domain/subscription";
import type { Transaction } from "@/lib/domain/transaction";

/**
 * INSIGHTS ENGINE — savings opportunities from the statement ALONE. No account
 * access, no credentials, no LLM calls of its own: pure, deterministic analysis
 * over the classified subscriptions (+ the underlying transactions for trends).
 * This is the risk-free core of the savings agent — it only ever *recommends*.
 */

const eurFromMinor = (minor: number): string => `€${(minor / 100).toFixed(2)}`;
const yearMonth = (iso: string): string => slice7(iso);
function slice7(iso: string): string {
  return iso.slice(0, 7);
}

/** Only genuine subscriptions are candidates for these insights. */
const realSubs = (subs: readonly Subscription[]): readonly Subscription[] =>
  subs.filter((s) => s.kind === "subscription");

const minor = (s: Subscription): number => Math.round(s.currentMonthly.monthlyEUR * 100);
const merchantId = (s: Subscription): string => s.merchantNormalized.trim().toLowerCase();

/**
 * OVERLAP — several DISTINCT brands in one spend-category. Running 7 different
 * image-gen tools is the headline redundancy; consolidating to 1–2 is the
 * saving. Same-brand repeats are a DUPLICATE (handled separately), so here we
 * collapse to one entry per brand (the priciest) before counting — otherwise
 * "PlayStation, PlayStation" would masquerade as category overlap.
 */
function detectOverlap(subs: readonly Subscription[]): Finding[] {
  const byCategory = new Map<string, Subscription[]>();
  for (const s of realSubs(subs)) {
    if (s.category === "other") continue; // "other" is a grab-bag, not a real group
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }

  const findings: Finding[] = [];
  for (const [category, list] of byCategory) {
    // Collapse to one representative (priciest) entry per distinct brand.
    const byMerchant = new Map<string, Subscription>();
    for (const s of list) {
      const cur = byMerchant.get(merchantId(s));
      if (!cur || minor(s) > minor(cur)) byMerchant.set(merchantId(s), s);
    }
    const distinct = [...byMerchant.values()].sort((a, b) => minor(b) - minor(a));
    if (distinct.length < 2) continue; // only repeats of one brand → not an overlap

    const totalMinor = distinct.reduce((sum, s) => sum + minor(s), 0);
    // Savable = everything except the single most expensive (kept) tool.
    const savableMinor = totalMinor - minor(distinct[0]);
    const names = distinct.map((s) => s.merchantNormalized).join(", ");
    const label = CATEGORY_LABEL[distinct[0].category];
    findings.push({
      id: `overlap-${category}`,
      type: "overlap",
      severity: distinct.length >= 4 ? "high" : "medium",
      title: `${distinct.length} ${label} subscriptions — ${eurFromMinor(totalMinor)}/mo combined`,
      detail: `You pay for ${distinct.length} overlapping ${label} tools: ${names}. Consolidating to the one you use most could free up to ${eurFromMinor(savableMinor)}/mo.`,
      category: distinct[0].category,
      affectedSubscriptionIds: distinct.map((s) => s.id),
      estimatedMonthlySavingsEUR: savableMinor / 100,
    });
  }
  return findings;
}

/**
 * DUPLICATE — the SAME brand billed by two parallel subscriptions at a SIMILAR
 * price (the high-confidence "billed twice / two identical plans" signal). A big
 * price gap (Apple 119.99 + 34.99) means two different products, not a duplicate
 * — that's left to the category-overlap story. Variable (metered) entries are
 * excluded: a usage bill next to a flat plan is expected, not a duplicate.
 */
function detectDuplicate(subs: readonly Subscription[]): Finding[] {
  const byMerchant = new Map<string, Subscription[]>();
  for (const s of realSubs(subs)) {
    if (s.variableAmount) continue;
    const list = byMerchant.get(merchantId(s)) ?? [];
    list.push(s);
    byMerchant.set(merchantId(s), list);
  }

  const findings: Finding[] = [];
  for (const [, list] of byMerchant) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => minor(b) - minor(a));
    // Similar price = likely the SAME plan billed twice. Ratio guards against
    // pairing two genuinely different products under one brand.
    const ratio = minor(sorted[0]) / Math.max(1, minor(sorted[sorted.length - 1]));
    if (ratio > 1.5) continue;
    const name = sorted[0].merchantNormalized;
    const cheaperMinor = minor(sorted[sorted.length - 1]);
    const prices = sorted.map((s) => eurFromMinor(minor(s))).join(" + ");
    findings.push({
      // Suffix the unique subscription id so two brands differing only in
      // punctuation ("A-B" vs "A.B") can't collide on the same React key.
      id: `duplicate-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${sorted[0].id}`,
      type: "duplicate",
      severity: "high",
      title: `${list.length}× ${name} at the same price`,
      detail: `${name} is billed by ${list.length} parallel subscriptions at a similar price (${prices}/mo) — likely a double charge or two identical plans. Cancelling the redundant one saves about ${eurFromMinor(cheaperMinor)}/mo.`,
      category: sorted[0].category === "other" ? undefined : sorted[0].category,
      affectedSubscriptionIds: sorted.map((s) => s.id),
      estimatedMonthlySavingsEUR: cheaperMinor / 100,
    });
  }
  return findings;
}

/**
 * ESCALATION — a subscription whose monthly cost has climbed over >= 3 distinct
 * recent months. Catches the "Notion 56 → 92 → 135" creep before it's noticed.
 * Uses the per-month spend reconstructed from the source transactions.
 */
function detectEscalation(
  subs: readonly Subscription[],
  txById: ReadonlyMap<string, Transaction>,
): Finding[] {
  const findings: Finding[] = [];
  for (const s of realSubs(subs)) {
    // Monthly total for this subscription, from its own source transactions.
    const byMonth = new Map<string, number>();
    for (const id of s.sourceTransactionIds) {
      const tx = txById.get(id);
      if (!tx) continue;
      const m = yearMonth(tx.date);
      byMonth.set(m, (byMonth.get(m) ?? 0) + Math.abs(tx.amount.amountMinor));
    }
    const months = [...byMonth.keys()].sort();
    if (months.length < 3) continue;
    const series = months.map((m) => byMonth.get(m) ?? 0);
    // Rising across the last 3 points, the overall rise is material (>20%), AND
    // the latest step is itself material — so a plateaued series (61.33 → 61.34
    // FX noise) is not flagged as still-climbing.
    const [a, b, c] = series.slice(-3);
    const deltaMinor = c - b; // most recent step-up — the avoidable creep
    const lastStepMaterial = deltaMinor >= 100 && deltaMinor >= b * 0.05;
    const rising = c > b && b > a && c >= a * 1.2 && lastStepMaterial;
    if (!rising) continue;
    findings.push({
      id: `escalation-${s.id}`,
      type: "escalation",
      severity: c >= a * 2 ? "high" : "medium",
      title: `${s.merchantNormalized} cost is climbing`,
      detail: `${s.merchantNormalized} rose ${eurFromMinor(a)} → ${eurFromMinor(b)} → ${eurFromMinor(c)}/mo over recent months. Check for a plan change or metered overage — the latest jump alone is ${eurFromMinor(deltaMinor)}/mo.`,
      category: s.category === "other" ? undefined : s.category,
      affectedSubscriptionIds: [s.id],
      estimatedMonthlySavingsEUR: deltaMinor / 100,
    });
  }
  return findings;
}

/**
 * ZOMBIE — entertainment/fitness spend that has run for many months at a steady
 * price: classic "forgot I had this". Flagged for a usage check (no auto-saving
 * estimate beyond the monthly cost, since whether it's used is the user's call).
 */
function detectZombie(subs: readonly Subscription[]): Finding[] {
  const findings: Finding[] = [];
  for (const s of realSubs(subs)) {
    // Restrict to monthly: charge count ≈ months only for monthly billing.
    // (A yearly sub with 6 charges = 6 years; multi-interval is a follow-up.)
    if (s.interval !== "monthly") continue;
    const longRunning = s.sourceTransactionIds.length >= 6;
    const leisure = s.category === "entertainment" || s.category === "fitness";
    if (!longRunning || !leisure || s.variableAmount) continue;
    const monthlyMinor = Math.round(s.currentMonthly.monthlyEUR * 100);
    findings.push({
      id: `zombie-${s.id}`,
      type: "zombie",
      severity: "low",
      title: `Still using ${s.merchantNormalized}?`,
      detail: `${s.merchantNormalized} (${CATEGORY_LABEL[s.category]}) has billed ${eurFromMinor(monthlyMinor)}/mo for ${s.sourceTransactionIds.length}+ months. If it's no longer used, cancelling recovers ${eurFromMinor(monthlyMinor)}/mo.`,
      category: s.category,
      affectedSubscriptionIds: [s.id],
      estimatedMonthlySavingsEUR: monthlyMinor / 100,
    });
  }
  return findings;
}

/**
 * Analyze classified subscriptions for savings opportunities. Pure: same input
 * → same findings, sorted by estimated monthly savings (highest first), then by
 * severity. `transactions` drives the escalation trend; pass [] to skip it.
 */
export function analyzeSubscriptions(
  subscriptions: readonly Subscription[],
  transactions: readonly Transaction[] = [],
): readonly Finding[] {
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [
    ...detectDuplicate(subscriptions),
    ...detectOverlap(subscriptions),
    ...detectEscalation(subscriptions, txById),
    ...detectZombie(subscriptions),
  ].sort((a, b) => {
    if (b.estimatedMonthlySavingsEUR !== a.estimatedMonthlySavingsEUR) {
      return b.estimatedMonthlySavingsEUR - a.estimatedMonthlySavingsEUR;
    }
    return rank[a.severity] - rank[b.severity];
  });
}
