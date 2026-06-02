"use client";

import { useEffect, useState } from "react";
import { eur } from "@/lib/ui/meta";

interface RunListItem {
  readonly id: string;
  readonly createdAt: string;
  readonly totalMonthlySavingsEUR: number;
  readonly switchCount: number;
}

interface HistoryPanelProps {
  readonly enabled: boolean;
  readonly refreshKey: number;
}

/** Per-user run history (only shown when signed-in + a DB is configured). */
export function HistoryPanel({ enabled, refreshKey }: HistoryPanelProps) {
  const [runs, setRuns] = useState<readonly RunListItem[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch("/api/history")
      .then((r) => r.json())
      .then((d) => {
        if (active) setRuns(d.runs ?? []);
      })
      .catch(() => {
        if (active) setRuns([]);
      });
    return () => {
      active = false;
    };
  }, [enabled, refreshKey]);

  if (!enabled || runs.length === 0) return null;

  return (
    <div className="panel p-5 reveal">
      <div className="eyebrow mb-3">Your run history</div>
      <div className="space-y-2">
        {runs.map((r) => (
          <div
            key={r.id}
            className="panel-inset p-3 flex items-center justify-between gap-3"
            style={{ fontSize: 13 }}
          >
            <span className="mono" style={{ color: "var(--ink-faint)", fontSize: 11 }}>
              {new Date(r.createdAt).toLocaleString()}
            </span>
            <span className="mono">
              <span style={{ color: "var(--gold)" }}>
                {eur(r.totalMonthlySavingsEUR)}
              </span>
              /mo · {r.switchCount} switches
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
