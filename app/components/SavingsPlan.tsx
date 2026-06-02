"use client";

import type { Recommendation } from "@/lib/domain/recommendation";
import type { Subscription } from "@/lib/domain/subscription";
import type { RunSnapshot } from "@/lib/orchestrator/types";
import { COUNTRY_META, SERVICE_META, countryName, eur } from "@/lib/ui/meta";

interface SavingsPlanProps {
  readonly snapshot: RunSnapshot;
  readonly executing: boolean;
  readonly onExecute: () => void;
}

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  return (
    <span className={`chip badge-risk-${level}`}>
      <span className="dot" /> {level} risk
    </span>
  );
}

function RecCard({
  rec,
  sub,
}: {
  rec: Recommendation;
  sub: Subscription | undefined;
}) {
  const sm = SERVICE_META[rec.service];
  const homeFlag = sub ? COUNTRY_META[sub.detectedCountry]?.flag ?? "🏳" : "🏳";
  const chosen = rec.chosen;

  return (
    <div className="panel-inset p-4 reveal">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span
            className="grid place-items-center rounded-xl"
            style={{
              width: 40,
              height: 40,
              background: `${sm.accent}1f`,
              color: sm.accent,
              fontSize: 18,
              border: `1px solid ${sm.accent}55`,
            }}
          >
            {sm.glyph}
          </span>
          <div>
            <div style={{ fontWeight: 600 }}>{sm.label}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
              {homeFlag} {sub ? countryName(sub.detectedCountry) : "home"} ·{" "}
              {eur(rec.currentMonthlyEUR)}/mo now
            </div>
          </div>
        </div>

        {rec.viable && chosen ? (
          <div className="text-right">
            <div className="savings-num" style={{ fontSize: 26 }}>
              −{eur(rec.monthlySavingsEUR)}
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
              /mo · {eur(rec.annualSavingsEUR)}/yr
            </div>
          </div>
        ) : (
          <span className="chip">already optimal</span>
        )}
      </div>

      {rec.viable && chosen && (
        <>
          <div
            className="mt-3 flex items-center gap-3 flex-wrap mono"
            style={{ fontSize: 12 }}
          >
            <span style={{ color: "var(--ink-dim)" }}>
              {COUNTRY_META[chosen.country]?.flag} switch to{" "}
              <span style={{ color: "var(--ink)" }}>{countryName(chosen.country)}</span>{" "}
              · {chosen.planName} · {eur(chosen.normalized.monthlyEUR)}/mo
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <RiskBadge level={rec.risk.level} />
            <span className="chip">
              {rec.paymentPath === "bitrefill_giftcard"
                ? "Bitrefill gift card"
                : "direct card"}
            </span>
            {rec.tradeoffs.slice(0, 2).map((t, i) => (
              <span key={i} className="chip" style={{ textTransform: "none" }}>
                {t}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The savings plan — per-subscription recommendations + the Execute action. */
export function SavingsPlan({ snapshot, executing, onExecute }: SavingsPlanProps) {
  const { subscriptions, optimization, report } = snapshot;
  const subById = new Map(subscriptions.map((s) => [s.id, s]));
  const recs = [...optimization.recommendations].sort(
    (a, b) => b.monthlySavingsEUR - a.monthlySavingsEUR,
  );
  const notOptimizable = subscriptions.filter((s) => !s.optimizable);
  const hasSwitches = report.switchCount > 0;

  return (
    <div className="panel p-5 reveal">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <span className="eyebrow">Savings plan</span>
        <button
          className="btn btn-gold"
          onClick={onExecute}
          disabled={executing || !hasSwitches}
        >
          {executing
            ? "Executing dry run…"
            : `Execute ${report.switchCount} switches (dry run)`}
        </button>
      </div>

      <div className="space-y-3">
        {recs.map((rec) => (
          <RecCard key={rec.subscriptionId} rec={rec} sub={subById.get(rec.subscriptionId)} />
        ))}
      </div>

      {notOptimizable.length > 0 && (
        <div className="mt-5">
          <div className="eyebrow mb-2">
            Detected · not optimizable ({notOptimizable.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {notOptimizable.map((s) => (
              <span key={s.id} className="chip" style={{ textTransform: "none" }}>
                {s.merchantNormalized} · {eur(s.currentMonthly.monthlyEUR)}/mo
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
