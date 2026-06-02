"use client";

import { useEffect, useRef } from "react";
import type { AgentEvent } from "@/lib/domain/events";
import { AGENT_ACCENT } from "@/lib/ui/meta";

interface AgentFeedProps {
  readonly events: readonly AgentEvent[];
  readonly running: boolean;
}

function clock(iso: string): string {
  // HH:MM:SS without pulling a date lib
  const t = iso.slice(11, 19);
  return t || "--:--:--";
}

/** Terminal-style live log of every agent event. */
export function AgentFeed({ events, running }: AgentFeedProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  return (
    <div className="panel p-4 h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <span className="eyebrow">Agent stream</span>
        <span className="chip" style={{ color: running ? "var(--green)" : "var(--ink-faint)" }}>
          <span className={`dot ${running ? "dot-live" : ""}`} />
          {running ? "live" : "idle"}
        </span>
      </div>
      <div className="panel-inset p-3 flex-1 min-h-0 overflow-y-auto scroll-thin mono" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
        {events.length === 0 && (
          <p style={{ color: "var(--ink-faint)" }}>
            // waiting for kernel boot…
          </p>
        )}
        {events.map((e, i) => {
          const accent = AGENT_ACCENT[e.agent] ?? "var(--ink-dim)";
          const isErr = e.phase === "error";
          return (
            <div key={i} className="reveal flex gap-2.5" style={{ animationDelay: "0ms" }}>
              <span style={{ color: "var(--ink-faint)" }}>{clock(e.at)}</span>
              <span style={{ color: accent, minWidth: 96, fontWeight: 600 }}>
                {e.agent}
                {e.country ? `·${e.country}` : ""}
              </span>
              <span style={{ color: isErr ? "var(--red)" : "var(--ink)", flex: 1 }}>
                {e.message}
              </span>
            </div>
          );
        })}
        {running && (
          <div className="flex gap-2.5">
            <span style={{ color: "var(--ink-faint)" }}>{">"}</span>
            <span className="caret" />
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
