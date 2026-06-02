import type { SearchProvider, SearchResponse } from "./types";

/** Offline fallback used only when no Tavily key is configured. */
export class MockSearch implements SearchProvider {
  async search(query: string): Promise<SearchResponse> {
    return {
      answer: `(mock) No live search configured. Query was: "${query}".`,
      hits: [],
    };
  }
}
