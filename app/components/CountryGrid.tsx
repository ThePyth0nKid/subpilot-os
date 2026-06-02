"use client";

import { useMemo } from "react";
import type { AgentEvent } from "@/lib/domain/events";
import type { GeoPriceResult } from "@/lib/domain/geo-price";
import type { RunStatus } from "@/lib/orchestrator/types";
import {
  COUNTRY_META,
  DEMO_COUNTRIES,
  SERVICE_META,
  eur,
} from "@/lib/ui/meta";

interface CountryGridProps {
  readonly events: readonly AgentEvent[];
  readonly status: RunStatus;
  readonly bestCountry: string | null;
}

interface CountryState {
  readonly prices: readonly GeoPriceResult[];
  readonly touched: boolean;
  readonly cheapest: number | null;
}

function deriveCountry(
  events: readonly AgentEvent[],
  code: string,
): CountryState {
  const mine = events.filter(
    (e) => e.agent === "geo-research" && e.country?.toUpperCase() === code,
  );
  const prices = mine
    .filter((e) => e.phase === "completed" && e.payload)
    .map((e) => e.payload as GeoPriceResult);
  const cheapest = prices.length
    ? Math.min(...prices.map((p) => p.normalized.monthlyEUR))
    : null;
  return { prices, touched: mine.length > 0, cheapest };
}

/** Per-country sandbox board — lights up live as research events arrive. */
export function CountryGrid({ events, status, bestCountry }: CountryGridProps) {
  const researching = status === "researching";
  const states = useMemo(
    () =>
      DEMO_COUNTRIES.map((code) => ({ code, ...deriveCountry(events, code) })),
    [events],
  );

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="eyebrow">Regional sandboxes · Daytona</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
          {states.reduce((n, s) => n + s.prices.length, 0)} prices captured
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {states.map((s) => {
          const isBest = bestCountry === s.code && status === "done";
          const active = researching && s.touched && s.prices.length < 5;
          const cls = isBest
            ? "country country-best"
            : active
              ? "country country-active"
              : "country";
          const meta = COUNTRY_META[s.code];
          return (
            <div
              key={s.code}
              className={`${cls} panel-inset relative overflow-hidden p-3.5`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 20 }}>{meta?.flag}</span>
                  <div className="leading-tight">
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{meta?.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>
                      {s.code} · sandbox
                    </div>
                  </div>
                </div>
                {isBest ? (
                  <span
                    className="chip"
                    style={{ color: "var(--gold)", borderColor: "rgba(233,177,90,0.5)" }}
                  >
                    ★ cheapest
                  </span>
                ) : (
                  <span
                    className={`dot ${active ? "dot-live" : ""}`}
                    style={{
                      color: active
                        ? "var(--cyan)"
                        : s.prices.length
                          ? "var(--green)"
                          : "var(--ink-faint)",
                    }}
                  />
                )}
              </div>

              <div className="mt-3 space-y-1.5 min-h-[44px]">
                {s.prices.length === 0 && (
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                    {active ? "probing egress…" : "queued"}
                  </div>
                )}
                {s.prices.map((p) => {
                  const sm = SERVICE_META[p.service];
                  return (
                    <div
                      key={p.service}
                      className="reveal flex items-center justify-between"
                      style={{ fontSize: 12 }}
                    >
                      <span className="flex items-center gap-1.5" style={{ color: "var(--ink-dim)" }}>
                        <span style={{ color: sm.accent }}>{sm.glyph}</span>
                        {sm.label}
                      </span>
                      <span className="mono" style={{ color: "var(--ink)" }}>
                        {eur(p.normalized.monthlyEUR)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {s.cheapest !== null && (
                <div
                  className="mt-2 pt-2 mono"
                  style={{ borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--ink-faint)" }}
                >
                  from <span style={{ color: "var(--gold)" }}>{eur(s.cheapest)}</span>/mo
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
