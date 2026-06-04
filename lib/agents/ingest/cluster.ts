import { REDACTION_PLACEHOLDER_WORDS } from "@/lib/anonymize";
import type { Transaction } from "@/lib/domain/transaction";

/** A recurring-charge candidate detected before any LLM involvement. */
export interface RecurringCandidate {
  readonly id: string;
  readonly merchantKey: string;
  readonly merchantRaw: string; // representative raw description
  readonly monthlyAmountMinor: number; // positive face value (median)
  readonly currency: string;
  readonly occurrences: number;
  readonly months: readonly string[]; // distinct YYYY-MM
  readonly sourceTransactionIds: readonly string[];
  /** Usage-based spend (API billing, metered usage) — amount is a per-month median. */
  readonly variableAmount: boolean;
}

/** Tokens that say nothing about the brand ("www.amazon.de" vs "www.dji.com"). */
const NON_BRAND_TOKENS = new Set(["WWW"]);

/**
 * First meaningful alphabetic token of a payee description (digits stripped).
 * The description is already redacted, so redaction placeholders ([IBAN],
 * [ACCT], …) are skipped — the brand token (NETFLIX) stays the cluster key even
 * when a redacted PII fragment precedes it.
 */
export function merchantKey(description: string): string {
  const tokens = description
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .split(/\s+/)
    .filter(
      (t) =>
        t.length >= 3 &&
        !REDACTION_PLACEHOLDER_WORDS.has(t) &&
        !NON_BRAND_TOKENS.has(t),
    );
  return tokens[0] ?? description.toUpperCase().trim();
}

const yearMonth = (iso: string): string => iso.slice(0, 7);
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * FX-drift tolerance: a USD-priced subscription charged in EUR moves a few
 * percent month to month (Midjourney: 30.14 → 30.72). FX drift is
 * PROPORTIONAL, so the band is relative (6% of the running median) with only
 * a tiny 10-cent floor — a large floor would merge genuinely different
 * micro-price points (2.99 vs 3.29 are different plans, not drift).
 */
const sameAmount = (amountMinor: number, clusterMedianMinor: number): boolean =>
  Math.abs(amountMinor - clusterMedianMinor) <=
  Math.max(10, Math.round(clusterMedianMinor * 0.06));

const distinctMonths = (txs: readonly Transaction[]): string[] =>
  [...new Set(txs.map((t) => yearMonth(t.date)))].sort();

const mostRecent = (txs: readonly Transaction[]): Transaction =>
  [...txs].sort((a, b) => b.date.localeCompare(a.date))[0];

/** Sweep amount-sorted charges into price-point groups (FX drift tolerated). */
function groupByPricePoint(txs: readonly Transaction[]): Transaction[][] {
  const sorted = [...txs].sort(
    (a, b) => Math.abs(a.amount.amountMinor) - Math.abs(b.amount.amountMinor),
  );
  const groups: Transaction[][] = [];
  for (const tx of sorted) {
    const current = groups[groups.length - 1];
    const abs = Math.abs(tx.amount.amountMinor);
    if (
      current &&
      sameAmount(abs, median(current.map((t) => Math.abs(t.amount.amountMinor))))
    ) {
      current.push(tx);
    } else {
      groups.push([tx]);
    }
  }
  return groups;
}

function toCandidate(
  list: readonly Transaction[],
  key: string,
  variableAmount: boolean,
  monthlyAmountMinor: number,
): RecurringCandidate {
  const currency = list[0].amount.currency;
  const suffix = variableAmount ? "var" : String(Math.round(monthlyAmountMinor / 100));
  const bucketId = `${key}|${currency}|${suffix}`;
  return {
    id: `sub-${bucketId.replace(/[^A-Z0-9]/gi, "-").toLowerCase()}`,
    merchantKey: key,
    merchantRaw: mostRecent(list).counterparty,
    monthlyAmountMinor,
    currency,
    occurrences: list.length,
    months: distinctMonths(list),
    sourceTransactionIds: list.map((t) => t.id),
    variableAmount,
  };
}

/**
 * Cluster expenses into recurring candidates — brand first, then price point.
 *
 * 1. Group expenses by (brand token, currency).
 * 2. Within a brand, sweep charges into price-point groups with FX tolerance —
 *    a fixed-price subscription stays ONE candidate even when the EUR amount
 *    drifts (USD billing), while two genuinely different plans (Claude Pro vs
 *    Max) stay separate. A price point qualifies with >= 2 charges across
 *    >= 2 distinct months.
 * 3. Brand leftovers (charges at no stable price point) with >= 3 charges
 *    across >= 2 months fold into ONE variable candidate — usage-based spend
 *    (API billing, metered IDE usage) at its per-month median instead of five
 *    phantom subscriptions. Whether that's a subscription or just repeated
 *    shopping is the classifier's call (`kind`), not ours.
 * 4. A brand with MANY qualifying price points is not many subscriptions —
 *    it's erratic spend (Cursor metered usage hit 7 "stable" price points by
 *    chance; P2P transfers repeat round numbers). Such brands collapse into
 *    ONE variable candidate over all their charges. Two price points stay
 *    separate: that's a genuine plan change (Claude Pro → Max).
 */
export function clusterRecurring(
  txs: readonly Transaction[],
): readonly RecurringCandidate[] {
  const expenses = txs.filter((t) => t.amount.amountMinor < 0);

  const brands = new Map<string, Transaction[]>();
  for (const tx of expenses) {
    const brandId = `${merchantKey(tx.counterparty)}|${tx.amount.currency}`;
    const list = brands.get(brandId) ?? [];
    list.push(tx);
    brands.set(brandId, list);
  }

  // Variable spend: median of MONTHLY TOTALS — honest for both many-small-
  // charges-per-month (API usage) and one-varying-charge-per-month.
  const variableCandidate = (list: readonly Transaction[], key: string) => {
    const byMonth = new Map<string, number>();
    for (const t of list) {
      const m = yearMonth(t.date);
      byMonth.set(m, (byMonth.get(m) ?? 0) + Math.abs(t.amount.amountMinor));
    }
    return toCandidate(list, key, true, median([...byMonth.values()]));
  };

  const candidates: RecurringCandidate[] = [];
  for (const [brandId, list] of brands) {
    const key = brandId.split("|")[0];
    const fixed: Transaction[][] = [];
    const leftovers: Transaction[] = [];

    for (const group of groupByPricePoint(list)) {
      if (group.length >= 2 && distinctMonths(group).length >= 2) {
        fixed.push(group);
      } else {
        leftovers.push(...group);
      }
    }
    const leftoversQualify =
      leftovers.length >= 3 && distinctMonths(leftovers).length >= 2;

    if (fixed.length >= 3 || (fixed.length >= 2 && leftoversQualify)) {
      // Erratic brand (rule 4): one variable candidate over ALL its charges.
      candidates.push(variableCandidate(list, key));
      continue;
    }
    for (const group of fixed) {
      const amounts = group.map((t) => Math.abs(t.amount.amountMinor));
      candidates.push(toCandidate(group, key, false, median(amounts)));
    }
    if (leftoversQualify) candidates.push(variableCandidate(leftovers, key));
  }

  return candidates.sort((a, b) => b.monthlyAmountMinor - a.monthlyAmountMinor);
}
