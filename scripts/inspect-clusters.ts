/**
 * Local debug tool: parse a real bank CSV and print every recurring cluster
 * with ALL constituent transactions — shows what the deterministic clustering
 * merges together (and what it misses). Zero LLM, zero keys, local only.
 *
 *   npx tsx scripts/inspect-clusters.ts "C:\path\to\statement.csv"
 */
import { readFileSync } from "node:fs";
import { parseCsv } from "@/lib/agents/ingest/parse";
import { clusterRecurring, merchantKey } from "@/lib/agents/ingest/cluster";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/inspect-clusters.ts <statement.csv>");
  process.exit(1);
}

const txs = parseCsv(readFileSync(file, "utf8"));
const byId = new Map(txs.map((t) => [t.id, t]));
const clusters = clusterRecurring(txs);

console.log(`transactions: ${txs.length}, recurring clusters: ${clusters.length}\n`);

for (const c of clusters) {
  const eur = (c.monthlyAmountMinor / 100).toFixed(2);
  const flag = c.variableAmount ? "  [VARIABLE]" : "";
  console.log(`── ${c.merchantKey}  ~${eur} ${c.currency}/mo  ×${c.occurrences} (${c.months.join(", ")})${flag}`);
  // distinct counterparty descriptions inside this cluster — >1 distinct
  // description with different brands = the "mixing" symptom
  const descs = new Map<string, number>();
  for (const id of c.sourceTransactionIds) {
    const t = byId.get(id);
    if (!t) continue;
    descs.set(t.counterparty, (descs.get(t.counterparty) ?? 0) + 1);
  }
  for (const [d, n] of descs) console.log(`     ${n}× ${d}`);
  console.log();
}

// Bonus: expenses that share a merchantKey with a cluster but landed in a
// DIFFERENT amount bucket (amount drift → same sub split across clusters)
const clusteredIds = new Set(clusters.flatMap((c) => [...c.sourceTransactionIds]));
const clusterKeys = new Set(clusters.map((c) => c.merchantKey));
const orphans = txs.filter(
  (t) => t.amount.amountMinor < 0 && !clusteredIds.has(t.id) && clusterKeys.has(merchantKey(t.counterparty)),
);
if (orphans.length > 0) {
  console.log(`⚠ ${orphans.length} expenses share a brand key with a cluster but missed it (amount drift):`);
  for (const t of orphans.slice(0, 40)) {
    console.log(`     ${t.date}  ${(t.amount.amountMinor / 100).toFixed(2)} ${t.amount.currency}  ${t.counterparty}`);
  }
}
