import "./_setup";
import { getProviders } from "@/lib/providers";

async function main() {
  const query = process.argv.slice(2).join(" ") || "Spotify price India 2026";
  const { search, modes } = getProviders();
  console.log(`[smoke-search] provider=${modes.search} query="${query}"`);
  const res = await search.search(query, { maxResults: 5, country: "IN" });
  console.log("\n=== ANSWER ===\n" + (res.answer ?? "(no answer)"));
  console.log("\n=== TOP HITS ===");
  res.hits.slice(0, 3).forEach((h, i) => {
    console.log(`${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet.slice(0, 140)}`);
  });
}

main().catch((e) => {
  console.error("[smoke-search] FAILED:", e);
  process.exit(1);
});
