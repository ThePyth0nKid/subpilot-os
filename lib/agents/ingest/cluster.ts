import type { Transaction } from "@/lib/domain/transaction";

/** A recurring-charge candidate detected before any LLM involvement. */
export interface RecurringCandidate {
  readonly id: string;
  readonly merchantKey: string;
  readonly merchantRaw: string; // representative raw description
  readonly monthlyAmountMinor: number; // positive face value
  readonly currency: string;
  readonly occurrences: number;
  readonly months: readonly string[]; // distinct YYYY-MM
  readonly sourceTransactionIds: readonly string[];
}

/** First meaningful alphabetic token of a payee description (digits stripped). */
export function merchantKey(description: string): string {
  const tokens = description
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  return tokens[0] ?? description.toUpperCase().trim();
}

const yearMonth = (iso: string): string => iso.slice(0, 7);
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Cluster expenses into recurring candidates. A bucket = (merchant, ~rounded
 * monthly amount). Recurring = appears in >= 2 distinct months. Variable-amount
 * spend (groceries, fuel) lands in different buckets and is filtered out — this
 * is the deterministic "selection" of subscriptions from a messy statement.
 */
export function clusterRecurring(
  txs: readonly Transaction[],
): readonly RecurringCandidate[] {
  const expenses = txs.filter((t) => t.amount.amountMinor < 0);

  const buckets = new Map<string, Transaction[]>();
  for (const tx of expenses) {
    const key = merchantKey(tx.counterparty);
    const euros = Math.round(Math.abs(tx.amount.amountMinor) / 100);
    const bucketId = `${key}|${tx.amount.currency}|${euros}`;
    const list = buckets.get(bucketId) ?? [];
    list.push(tx);
    buckets.set(bucketId, list);
  }

  const candidates: RecurringCandidate[] = [];
  for (const [bucketId, list] of buckets) {
    const months = [...new Set(list.map((t) => yearMonth(t.date)))];
    if (list.length < 2 || months.length < 2) continue;

    const amounts = list.map((t) => Math.abs(t.amount.amountMinor));
    const recent = [...list].sort((a, b) => b.date.localeCompare(a.date))[0];
    candidates.push({
      id: `sub-${bucketId.replace(/[^A-Z0-9]/gi, "-").toLowerCase()}`,
      merchantKey: bucketId.split("|")[0],
      merchantRaw: recent.counterparty,
      monthlyAmountMinor: median(amounts),
      currency: list[0].amount.currency,
      occurrences: list.length,
      months: months.sort(),
      sourceTransactionIds: list.map((t) => t.id),
    });
  }

  return candidates.sort((a, b) => b.monthlyAmountMinor - a.monthlyAmountMinor);
}
