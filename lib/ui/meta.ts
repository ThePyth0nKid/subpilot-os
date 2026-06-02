import type { ServiceSlug } from "@/lib/domain/subscription";
import type { RunStatus } from "@/lib/orchestrator/types";

export interface ServiceMeta {
  readonly label: string;
  readonly accent: string;
  readonly glyph: string;
}

export const SERVICE_META: Readonly<Record<ServiceSlug, ServiceMeta>> = {
  netflix: { label: "Netflix", accent: "#e50914", glyph: "N" },
  spotify: { label: "Spotify", accent: "#1db954", glyph: "♫" },
  youtube_premium: { label: "YouTube Premium", accent: "#ff4e45", glyph: "▶" },
  disney_plus: { label: "Disney+", accent: "#3a7bd5", glyph: "✦" },
  chatgpt: { label: "ChatGPT Plus", accent: "#10a37f", glyph: "✸" },
  unknown: { label: "Recurring", accent: "#7d8290", glyph: "•" },
};

export interface CountryMeta {
  readonly name: string;
  readonly flag: string;
}

export const COUNTRY_META: Readonly<Record<string, CountryMeta>> = {
  IN: { name: "India", flag: "🇮🇳" },
  TR: { name: "Türkiye", flag: "🇹🇷" },
  US: { name: "United States", flag: "🇺🇸" },
  DE: { name: "Germany", flag: "🇩🇪" },
  AR: { name: "Argentina", flag: "🇦🇷" },
};

export const DEMO_COUNTRIES = ["IN", "TR", "US", "DE"] as const;

export interface PhaseMeta {
  readonly key: RunStatus;
  readonly label: string;
}

/** The kernel state machine, in display order. */
export const PHASES: readonly PhaseMeta[] = [
  { key: "ingesting", label: "Ingest" },
  { key: "interviewing", label: "Interview" },
  { key: "researching", label: "Geo-Research" },
  { key: "optimizing", label: "Optimize" },
  { key: "reporting", label: "Report" },
  { key: "done", label: "Done" },
];

export const AGENT_ACCENT: Readonly<Record<string, string>> = {
  orchestrator: "#9d8cff",
  ingest: "#62cbff",
  interview: "#f4d199",
  "geo-research": "#62cbff",
  constraint: "#ffba5c",
  optimizer: "#e9b15a",
  action: "#38d39f",
  report: "#38d39f",
};

export const eur = (n: number): string =>
  `€${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const countryName = (code: string): string =>
  COUNTRY_META[code.toUpperCase()]?.name ?? code.toUpperCase();
