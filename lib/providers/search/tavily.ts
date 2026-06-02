import type {
  SearchOptions,
  SearchProvider,
  SearchResponse,
} from "./types";

const TAVILY_URL = "https://api.tavily.com/search";

interface TavilyRaw {
  readonly answer?: string;
  readonly results?: ReadonlyArray<{
    readonly title?: string;
    readonly url?: string;
    readonly content?: string;
  }>;
}

/** Real Tavily search. Auth via Bearer token; query is country-biased by caller. */
export class TavilySearch implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        include_answer: true,
        max_results: opts.maxResults ?? 5,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily search failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const raw = (await res.json()) as TavilyRaw;
    return {
      answer: raw.answer,
      hits: (raw.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      })),
    };
  }
}
