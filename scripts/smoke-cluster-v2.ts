import { z } from "zod";
import { clusterRecurring, merchantKey } from "@/lib/agents/ingest/cluster";
import { ingest } from "@/lib/agents/ingest";
import type { Transaction } from "@/lib/domain/transaction";
import type { CompleteArgs, ExtractArgs, LlmClient } from "@/lib/providers/llm/types";

/**
 * PURE, zero-env gate for PR-M5 (clustering v2 + kind classification).
 * Verifies: FX-drift price points stay ONE subscription, genuine plan changes
 * stay separate, usage-based spend folds into one variable candidate, erratic
 * brands (many price points) collapse, and the `kind` classification keeps
 * P2P/retail out of the optimizable set. The LLM is a deterministic stub —
 * no keys, no network.
 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-cluster-v2] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-cluster-v2] ok: ${msg}`);
}

let txCounter = 0;
const tx = (date: string, counterparty: string, amountEur: number): Transaction => ({
  id: `tx-${txCounter++}`,
  date,
  amount: { amountMinor: Math.round(amountEur * 100), currency: "EUR" },
  counterparty,
});

// ── 1. FX drift: one USD-priced sub, EUR amount wobbles → ONE fixed candidate ──
{
  const cands = clusterRecurring([
    tx("2026-01-05", "MIDJOURNEY INC.", -30.14),
    tx("2026-02-05", "MIDJOURNEY INC.", -30.46),
    tx("2026-03-05", "MIDJOURNEY INC.", -30.72),
  ]);
  assert(cands.length === 1, "1: FX-drifting charges merge into one candidate");
  assert(!cands[0].variableAmount, "1: stable price point is NOT variable");
  assert(cands[0].monthlyAmountMinor === 3046, "1: median amount picked");
  assert(cands[0].occurrences === 3, "1: all three charges in the cluster");
}

// ── 2. Two genuine plans (Pro → Max) stay separate candidates ──
{
  const cands = clusterRecurring([
    tx("2025-11-01", "CLAUDE.AI SUBSCRIPTION", -21.42),
    tx("2025-12-01", "CLAUDE.AI SUBSCRIPTION", -21.42),
    tx("2026-01-01", "CLAUDE.AI SUBSCRIPTION", -21.42),
    tx("2026-02-01", "CLAUDE.AI SUBSCRIPTION", -214.2),
    tx("2026-03-01", "CLAUDE.AI SUBSCRIPTION", -214.2),
    tx("2026-04-01", "CLAUDE.AI SUBSCRIPTION", -214.2),
  ]);
  assert(cands.length === 2, "2: two price points = two candidates (plan change)");
  assert(
    cands.every((c) => !c.variableAmount),
    "2: both plans are fixed-price",
  );
}

// ── 3. Usage-based spend with NO stable price point → ONE variable candidate ──
{
  const cands = clusterRecurring([
    tx("2026-01-10", "ANTHROPIC", -102.98),
    tx("2026-01-25", "ANTHROPIC", -5.95),
    tx("2026-02-10", "ANTHROPIC", -51.72),
    tx("2026-03-10", "ANTHROPIC", -25.82),
  ]);
  assert(cands.length === 1, "3: scattered API charges fold into one candidate");
  assert(cands[0].variableAmount, "3: usage-based spend flagged variable");
  // monthly totals: Jan 108.93, Feb 51.72, Mar 25.82 → median 51.72
  assert(cands[0].monthlyAmountMinor === 5172, "3: median of MONTHLY TOTALS");
  assert(cands[0].occurrences === 4, "3: all charges accounted for");
}

// ── 4. Erratic brand: >=3 qualifying price points collapse into ONE variable ──
{
  const cands = clusterRecurring([
    tx("2026-01-03", "CURSOR, AI POWERED IDE", -17.08),
    tx("2026-02-03", "CURSOR, AI POWERED IDE", -17.08),
    tx("2026-01-15", "CURSOR, AI POWERED IDE", -62.6),
    tx("2026-02-15", "CURSOR, AI POWERED IDE", -62.6),
    tx("2026-01-25", "CURSOR USAGE  JAN", -86.54),
    tx("2026-02-25", "CURSOR USAGE  FEB", -86.54),
  ]);
  assert(cands.length === 1, "4: 3 price points = erratic brand → one candidate");
  assert(cands[0].variableAmount, "4: erratic brand flagged variable");
  assert(cands[0].occurrences === 6, "4: ALL brand charges folded in");
}

// ── 5. Recurrence guards: same month / single charge never qualifies ──
{
  const sameMonth = clusterRecurring([
    tx("2026-01-05", "ONEOFF SHOP", -9.99),
    tx("2026-01-20", "ONEOFF SHOP", -9.99),
  ]);
  assert(sameMonth.length === 0, "5: two charges in ONE month don't qualify");
  const single = clusterRecurring([tx("2026-01-05", "SINGLE PURCHASE", -49.0)]);
  assert(single.length === 0, "5: a single charge never qualifies");
}

// ── 6. Brand token: WWW is not a brand; micro-charges don't chain-merge ──
{
  assert(merchantKey("WWW.AMAZON.DE") === "AMAZON", "6: www. prefix skipped");
  assert(
    merchantKey("WWW.PERPLEXITY.AI") === "PERPLEXITY",
    "6: domains keep their brand token",
  );
  const cands = clusterRecurring([
    tx("2026-01-05", "APPLE.COM/BILL", -0.99),
    tx("2026-02-05", "APPLE.COM/BILL", -0.99),
    tx("2026-01-09", "APPLE.COM/BILL", -1.99),
    tx("2026-02-09", "APPLE.COM/BILL", -1.99),
  ]);
  assert(cands.length === 2, "6: 0.99 vs 1.99 stay separate price points");
  const close = clusterRecurring([
    tx("2026-01-05", "ICLOUD STORAGE", -2.99),
    tx("2026-02-05", "ICLOUD STORAGE", -2.99),
    tx("2026-01-09", "ICLOUD STORAGE", -3.29),
    tx("2026-02-09", "ICLOUD STORAGE", -3.29),
  ]);
  assert(close.length === 2, "6: 2.99 vs 3.29 are plans, not FX drift");
}

// ── 6b. Plan change + a few strays must NOT collapse into variable ──
{
  const cands = clusterRecurring([
    tx("2025-11-01", "CLAUDE.AI SUBSCRIPTION", -21.42),
    tx("2025-12-01", "CLAUDE.AI SUBSCRIPTION", -21.42),
    tx("2026-01-01", "CLAUDE.AI SUBSCRIPTION", -214.2),
    tx("2026-02-01", "CLAUDE.AI SUBSCRIPTION", -214.2),
    tx("2026-02-15", "CLAUDE.AI SUBSCRIPTION", -5.0), // billing correction
    tx("2026-02-20", "CLAUDE.AI SUBSCRIPTION", -7.5), // one-off top-up
  ]);
  assert(cands.length === 2, "6b: two strays don't destroy the plan separation");
  assert(
    cands.every((c) => !c.variableAmount),
    "6b: both plans still fixed-price",
  );
}

// ── 7. ingest E2E with stub LLM: kind gates optimizable + sections ──
async function section7(): Promise<void> {
  const csv = [
    "date,description,amount,currency",
    "2026-01-02,NETFLIX.COM,-19.99,EUR",
    "2026-02-02,NETFLIX.COM,-19.99,EUR",
    "2026-01-15,Miriam Mustermann Privat,-300.00,EUR",
    "2026-02-15,Miriam Mustermann Auszahlung,-300.00,EUR",
    "2026-01-07,AMZN Mktp DE,-36.99,EUR",
    "2026-01-21,AMZN Mktp DE,-14.5,EUR",
    "2026-02-11,AMZN Mktp DE,-89.0,EUR",
    "2026-01-09,OPENAI API,-47.11,EUR",
    "2026-01-28,OPENAI API,-12.02,EUR",
    "2026-02-09,OPENAI API,-83.4,EUR",
  ].join("\n");

  const stubLlm: LlmClient = {
    complete: async (_args: CompleteArgs) => "",
    extract: async <T>(args: ExtractArgs<T>): Promise<T> => {
      const payload = JSON.parse(args.user.slice(args.user.indexOf("\n") + 1)) as Array<{
        index: number;
        merchantRaw: string;
        variableAmount: boolean;
      }>;
      const classifications = payload.map((c) => {
        const raw = c.merchantRaw.toUpperCase();
        const [service, kind] = raw.includes("NETFLIX")
          ? ["netflix", "subscription"]
          : raw.includes("OPENAI")
            ? ["chatgpt", "subscription"] // brand-mapped metered API spend
            : raw.includes("MIRIAM")
              ? ["unknown", "p2p"]
              : ["unknown", "retail"];
        return {
          index: c.index,
          merchantNormalized: c.merchantRaw.split(" ")[0],
          service,
          kind,
          interval: "monthly",
          detectedCountry: "DE",
          confidence: 0.9,
        };
      });
      return (args.schema as unknown as z.ZodType<T>).parse({ classifications });
    },
  };

  const subs = await ingest(csv, { llm: stubLlm });
  assert(subs.length === 4, "7: four candidates survive ingest");

  const netflix = subs.find((s) => s.service === "netflix");
  const openai = subs.find((s) => s.service === "chatgpt");
  const miriam = subs.find((s) => s.kind === "p2p");
  const amzn = subs.find((s) => s.kind === "retail");
  assert(!!netflix && netflix.optimizable, "7: netflix subscription is optimizable");
  assert(
    !!openai && openai.variableAmount && !openai.optimizable,
    "7: metered API spend on an optimizable brand is NOT optimizable",
  );
  assert(!!miriam && !miriam.optimizable, "7: P2P transfer is NEVER optimizable");
  assert(!!amzn && !amzn.optimizable && amzn.variableAmount, "7: retail spend variable + not optimizable");
  assert(subs[0].service === "netflix", "7: optimizable tier sorts first");
  assert(
    subs[1].kind === "subscription" && subs[2].kind !== "subscription",
    "7: non-optimizable subscription before non-subscriptions",
  );
}

section7()
  .then(() => console.log("[smoke-cluster-v2] ALL PASS"))
  .catch((err: unknown) => {
    console.error(`[smoke-cluster-v2] FAIL: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
