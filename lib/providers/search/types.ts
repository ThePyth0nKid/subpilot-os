export interface SearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface SearchResponse {
  readonly answer?: string;
  readonly hits: readonly SearchHit[];
}

export interface SearchOptions {
  readonly maxResults?: number;
  readonly country?: string; // ISO-2; used to bias the query
}

/** Web discovery + geo price cross-check. */
export interface SearchProvider {
  search(query: string, opts?: SearchOptions): Promise<SearchResponse>;
}
