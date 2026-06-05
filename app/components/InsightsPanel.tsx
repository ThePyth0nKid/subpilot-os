"use client";

import type { Finding, FindingType } from "@/lib/domain/insight";
import { eur } from "@/lib/ui/meta";

interface InsightsPanelProps {
  readonly findings: readonly Finding[];
}

const TYPE_GLYPH: Readonly<Record<FindingType, string>> = {
  duplicate: "⧉",
  overlap: "⊕",
  escalation: "↗",
  zombie: "☾",
};

const TYPE_LABEL: Readonly<Record<FindingType, string>> = {
  duplicate: "Duplicate",
  overlap: "Overlap",
  escalation: "Rising cost",
  zombie: "Possibly unused",
};

function SeverityDot({ level }: { level: Finding["severity"] }) {
  return <span className={`dot badge-risk-${level === "high" ? "high" : level === "medium" ? "medium" : "low"}`} />;
}

/** Risk-free savings opportunities from the statement alone — no account access. */
export function InsightsPanel({ findings }: InsightsPanelProps) {
  if (findings.length === 0) return null;
  const totalEUR = findings.reduce((s, f) => s + f.estimatedMonthlySavingsEUR, 0);

  return (
    <div className="panel p-5 reveal">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <span className="eyebrow">Savings opportunities</span>
        {totalEUR > 0 && (
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
            up to <span style={{ color: "var(--gold)", fontWeight: 600 }}>{eur(totalEUR)}</span>/mo ·{" "}
            {eur(totalEUR * 12)}/yr
          </span>
        )}
      </div>

      <div className="space-y-3">
        {findings.map((f) => (
          <div key={f.id} className="panel-inset p-4 reveal">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3">
                <span
                  className="grid place-items-center rounded-xl"
                  style={{
                    width: 36,
                    height: 36,
                    background: "var(--gold-soft, #ffd16622)",
                    color: "var(--gold)",
                    fontSize: 18,
                  }}
                >
                  {TYPE_GLYPH[f.type]}
                </span>
                <div>
                  <div style={{ fontWeight: 600 }}>{f.title}</div>
                  <div
                    className="mt-1"
                    style={{ fontSize: 13, color: "var(--ink-dim)", maxWidth: 560 }}
                  >
                    {f.detail}
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="chip" style={{ textTransform: "none" }}>
                      <SeverityDot level={f.severity} /> {TYPE_LABEL[f.type]}
                    </span>
                  </div>
                </div>
              </div>
              {f.estimatedMonthlySavingsEUR > 0 && (
                <div className="text-right">
                  <div className="savings-num" style={{ fontSize: 22 }}>
                    −{eur(f.estimatedMonthlySavingsEUR)}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                    /mo potential
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
