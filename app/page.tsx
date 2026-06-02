"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionResult } from "@/lib/domain/action";
import { AgentFeed } from "@/app/components/AgentFeed";
import { CountryGrid } from "@/app/components/CountryGrid";
import { HistoryPanel } from "@/app/components/HistoryPanel";
import { KernelStrip } from "@/app/components/KernelStrip";
import { ReceiptPanel } from "@/app/components/ReceiptPanel";
import { SavingsPlan } from "@/app/components/SavingsPlan";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { eur } from "@/lib/ui/meta";
import { useRun } from "@/lib/ui/useRun";

interface ProviderModes {
  readonly search: string;
  readonly proxy: string;
  readonly payment: string;
}

function useCountUp(target: number, run: boolean): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (!run) return;
    const from = fromRef.current;
    const start = performance.now();
    const dur = 1100;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return value;
}

export default function Home() {
  const { status, events, snapshot, error, running, start } = useRun();
  const { user } = useAuth();
  const [modes, setModes] = useState<ProviderModes | null>(null);
  const [authOn, setAuthOn] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [receipts, setReceipts] = useState<readonly ActionResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => {
        setModes(d.modes ?? null);
        setAuthOn(Boolean(d.authEnabled));
      })
      .catch(() => setModes(null));
  }, []);

  const needsAuth = authOn && !user;

  const [historyTick, setHistoryTick] = useState(0);
  useEffect(() => {
    if (status === "done") setHistoryTick((t) => t + 1);
  }, [status]);

  const monthlySaved = snapshot?.report.totalMonthlySavingsEUR ?? 0;
  const animatedSaved = useCountUp(monthlySaved, status === "done");

  const bestCountry = useMemo(() => {
    if (!snapshot) return null;
    const tally = new Map<string, number>();
    for (const r of snapshot.optimization.recommendations) {
      if (r.viable && r.chosen) {
        tally.set(r.chosen.country, (tally.get(r.chosen.country) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    let max = 0;
    for (const [c, n] of tally) {
      if (n > max) {
        max = n;
        best = c;
      }
    }
    return best;
  }, [snapshot]);

  const runWith = useCallback(
    (csv: string) => {
      if (authOn && !user) {
        window.location.href = "/login";
        return;
      }
      setReceipts([]);
      void start(csv);
    },
    [start, authOn, user],
  );

  const onTryDemo = useCallback(async () => {
    try {
      const csv = await fetch("/api/sample").then((r) => r.text());
      runWith(csv);
    } catch {
      /* ignore — button stays available */
    }
  }, [runWith]);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      runWith(await file.text());
    },
    [runWith],
  );

  const onExecute = useCallback(async () => {
    if (!snapshot) return;
    const subById = new Map(snapshot.subscriptions.map((s) => [s.id, s]));
    const orders = snapshot.optimization.recommendations
      .filter((r) => r.viable && r.chosen)
      .map((r) => ({
        subscriptionId: r.subscriptionId,
        service: r.service,
        country: r.chosen!.country,
        oldCountry: subById.get(r.subscriptionId)?.detectedCountry,
        amountMinor: r.chosen!.price.amountMinor,
        currency: r.chosen!.price.currency,
      }));
    if (orders.length === 0) return;
    setExecuting(true);
    try {
      const res = await fetch("/api/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders, dryRun: true }),
      });
      const data = (await res.json()) as { results?: ActionResult[] };
      setReceipts(data.results ?? []);
    } catch {
      /* surfaced via empty receipts */
    } finally {
      setExecuting(false);
    }
  }, [snapshot]);

  const started = status !== "idle";

  return (
    <div className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8 py-8 sm:py-12">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div
            className="grid place-items-center rounded-xl"
            style={{
              width: 42,
              height: 42,
              background: "linear-gradient(160deg, var(--gold-soft), var(--gold))",
              color: "#1a1404",
              fontWeight: 800,
              fontSize: 20,
              boxShadow: "0 12px 34px -14px rgba(233,177,90,0.8)",
            }}
          >
            §
          </div>
          <div className="leading-tight">
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em" }}>
              SubPilot<span style={{ color: "var(--gold)" }}>OS</span>
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-faint)", letterSpacing: "0.1em" }}>
              AUTONOMOUS SUBSCRIPTION KERNEL
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="chip" style={{ color: "var(--green)" }}>
            <span className="dot dot-live" /> Anthropic
          </span>
          <span className="chip" style={{ color: "var(--cyan)" }}>
            <span className="dot dot-live" /> Daytona
          </span>
          <span className="chip" style={{ color: modes?.search === "tavily" ? "var(--green)" : "var(--ink-dim)" }}>
            <span className="dot" /> Tavily{modes && modes.search !== "tavily" ? " · mock" : ""}
          </span>
          <span className="chip">Bitrefill · mock</span>
          {authOn ? (
            user ? (
              <a
                href="/logout"
                className="chip"
                style={{ color: "var(--ink)", textTransform: "none" }}
                title="Sign out"
              >
                <span className="dot" style={{ color: "var(--green)" }} />
                {user.email} · sign out
              </a>
            ) : (
              <a href="/login" className="btn" style={{ padding: "6px 14px" }}>
                Sign in
              </a>
            )
          ) : (
            <span className="chip" title="Add WorkOS keys to enable login">
              auth · off
            </span>
          )}
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="mt-12 sm:mt-16">
        <span className="eyebrow">7 agents · 4 regions · 1 kernel</span>
        <h1
          className="mt-4 max-w-3xl"
          style={{ fontSize: "clamp(34px, 6vw, 62px)", fontWeight: 700, lineHeight: 1.02, letterSpacing: "-0.03em" }}
        >
          Your subscriptions are{" "}
          <span style={{ color: "var(--ink-faint)" }}>overpriced by region.</span>{" "}
          <span className="savings-num">SubPilot finds the gap.</span>
        </h1>
        <p className="mt-5 max-w-xl" style={{ color: "var(--ink-dim)", fontSize: 17, lineHeight: 1.5 }}>
          Drop in a bank statement. Watch seven specialized agents fan out across
          isolated regional sandboxes, price every plan worldwide, and hand you a
          one-click savings plan — fully audited.
        </p>

        {status === "done" && snapshot && (
          <div className="mt-8 flex items-end gap-6 flex-wrap reveal">
            <div>
              <div className="eyebrow mb-1">Reclaimable / month</div>
              <div className="savings-num" style={{ fontSize: "clamp(48px, 9vw, 88px)", lineHeight: 1 }}>
                {eur(animatedSaved)}
              </div>
            </div>
            <div className="pb-3 mono" style={{ color: "var(--ink-dim)", fontSize: 14, lineHeight: 1.8 }}>
              <div>
                <span style={{ color: "var(--gold)" }}>{eur(snapshot.report.totalAnnualSavingsEUR)}</span> / year
              </div>
              <div>
                {snapshot.report.switchCount} region switches ·{" "}
                {snapshot.optimization.recommendations.length} subscriptions
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Control ──────────────────────────────────────────── */}
      <section className="mt-10">
        <div
          className={`panel p-6 transition-colors`}
          style={dragOver ? { borderColor: "var(--gold)", background: "rgba(233,177,90,0.05)" } : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFiles(e.dataTransfer.files);
          }}
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>
                Drop your bank statement
                <span style={{ color: "var(--ink-faint)" }}> .csv</span>
              </div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4 }}>
                parsed locally · keys never enter sandboxes · dry-run only
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={running}>
                Upload CSV
              </button>
              <button className="btn btn-gold" onClick={onTryDemo} disabled={running}>
                {running
                  ? "Running…"
                  : needsAuth
                    ? "Sign in to run"
                    : "▶ Try the demo"}
              </button>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
          {error && (
            <div
              className="mt-4 panel-inset p-3 mono"
              style={{ fontSize: 12, color: "var(--red)", borderColor: "rgba(255,107,107,0.4)" }}
            >
              ✕ {error}
            </div>
          )}
        </div>
      </section>

      {/* ── Live pipeline ────────────────────────────────────── */}
      {started && (
        <section className="mt-8 reveal">
          <div className="panel px-5 py-3 mb-4">
            <KernelStrip status={status} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4" style={{ minHeight: 360 }}>
            <div className="h-[360px] lg:h-auto">
              <AgentFeed events={events} running={running} />
            </div>
            <CountryGrid events={events} status={status} bestCountry={bestCountry} />
          </div>
        </section>
      )}

      {/* ── Results ──────────────────────────────────────────── */}
      {snapshot && (
        <section className="mt-6">
          <SavingsPlan snapshot={snapshot} executing={executing} onExecute={onExecute} />
        </section>
      )}

      {receipts.length > 0 && (
        <section className="mt-6">
          <ReceiptPanel receipts={receipts} monthlySaved={monthlySaved} />
        </section>
      )}

      <section className="mt-6">
        <HistoryPanel enabled={Boolean(authOn && user)} refreshKey={historyTick} />
      </section>

      <footer className="mt-16 mb-6 flex items-center justify-between flex-wrap gap-3">
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
          SubPilot OS · credential-isolated multi-agent runtime
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
          Anthropic · Daytona · Tavily · Bitrefill
        </span>
      </footer>
    </div>
  );
}
