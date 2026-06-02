"use client";

import type { ActionResult } from "@/lib/domain/action";
import { eur } from "@/lib/ui/meta";

interface ReceiptPanelProps {
  readonly receipts: readonly ActionResult[];
  readonly monthlySaved: number;
}

/** Dry-run execution result: gift-card receipts + per-action audit trail. */
export function ReceiptPanel({ receipts, monthlySaved }: ReceiptPanelProps) {
  return (
    <div className="panel p-5 reveal" style={{ borderColor: "rgba(56,211,159,0.35)" }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <span className="eyebrow" style={{ color: "var(--green)" }}>
          ✓ Dry run complete
        </span>
        <span className="mono" style={{ fontSize: 13, color: "var(--green)" }}>
          {eur(monthlySaved)}/mo locked in · {receipts.length} receipts
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {receipts.map((r) => (
          <div key={r.subscriptionId} className="panel-inset p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="mono" style={{ fontSize: 12, color: "var(--gold)" }}>
                {r.giftCardSku}
              </span>
              <span className="chip" style={{ color: "var(--green)" }}>
                <span className="dot" /> {r.status.replace("_", " ")}
              </span>
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
              ref {r.receiptRef} · region {r.newAccountRegion}
            </div>
            <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--line)" }}>
              {r.audit.map((a, i) => (
                <div
                  key={i}
                  className="mono flex gap-2"
                  style={{ fontSize: 10.5, color: "var(--ink-dim)", lineHeight: 1.7 }}
                >
                  <span style={{ color: "var(--green)" }}>{">"}</span>
                  <span style={{ color: "var(--ink-faint)", minWidth: 48 }}>{a.step}</span>
                  <span>{a.detail}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
