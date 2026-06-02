import "./_setup";
import { researchMatrix } from "@/lib/agents/geo-research";
import { getProviders } from "@/lib/providers";

async function main() {
  const { search, llm, proxy, modes } = getProviders();
  console.log(`[smoke-research] search=${modes.search} proxy=${modes.proxy}`);

  const results = await researchMatrix(["netflix"], ["IN", "TR", "US", "DE"], {
    search,
    llm,
    proxy,
    onEvent: (e) =>
      console.log(`  · [${e.phase}] ${e.country ?? ""} ${e.message}`),
  });

  const sorted = [...results].sort(
    (a, b) => a.normalized.monthlyEUR - b.normalized.monthlyEUR,
  );
  console.log("\n=== NETFLIX REGIONAL PRICES (cheapest first) ===");
  for (const r of sorted) {
    console.log(
      `${r.country}  €${r.normalized.monthlyEUR.toFixed(2)}/mo  (${(r.price.amountMinor / 100).toFixed(2)} ${r.price.currency})  plan="${r.planName}" conf=${r.confidence}`,
    );
  }
  const cheapest = sorted[0];
  console.log(`\nCheapest: ${cheapest.country} at €${cheapest.normalized.monthlyEUR.toFixed(2)}/mo`);
  if (cheapest.country !== "IN") {
    console.warn("[smoke-research] WARN: expected India (IN) cheapest");
  } else {
    console.log("[smoke-research] OK — India cheapest");
  }
}

main().catch((e) => {
  console.error("[smoke-research] FAILED:", e);
  process.exit(1);
});
