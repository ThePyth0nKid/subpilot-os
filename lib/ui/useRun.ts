"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/domain/events";
import type { RunSnapshot, RunStatus } from "@/lib/orchestrator/types";

const STATUS_BY_AGENT: Readonly<Record<string, RunStatus>> = {
  orchestrator: "ingesting",
  ingest: "ingesting",
  interview: "interviewing",
  "geo-research": "researching",
  constraint: "optimizing",
  optimizer: "optimizing",
  report: "reporting",
  action: "done",
};

export interface RunHandle {
  readonly status: RunStatus;
  readonly events: readonly AgentEvent[];
  readonly snapshot: RunSnapshot | null;
  readonly error: string | null;
  readonly running: boolean;
  /** Start a run from CSV text (sent as text/plain) or a PDF File (multipart). */
  readonly start: (statement: string | File) => Promise<void>;
}

/** Owns the lifecycle of one optimization run + its SSE event stream. */
export function useRun(): RunHandle {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [events, setEvents] = useState<readonly AgentEvent[]>([]);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const start = useCallback(async (statement: string | File) => {
    esRef.current?.close();
    setEvents([]);
    setSnapshot(null);
    setError(null);
    setStatus("ingesting");

    // CSV text goes as text/plain; a File (PDF) goes as multipart so the server
    // can extract + anonymize the binary before any processing.
    let body: BodyInit;
    let headers: HeadersInit | undefined;
    if (typeof statement === "string") {
      body = statement;
      headers = { "Content-Type": "text/plain" };
    } else {
      const form = new FormData();
      form.append("file", statement);
      body = form; // the browser sets the multipart boundary itself
    }

    let runId: string;
    try {
      const res = await fetch("/api/run", { method: "POST", headers, body });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) {
        throw new Error(data.error ?? "Failed to start run");
      }
      runId = data.runId;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
      setStatus("error");
      return;
    }

    const es = new EventSource(`/api/run/${runId}/events`);
    esRef.current = es;

    es.onmessage = (msg: MessageEvent<string>) => {
      let ev: AgentEvent;
      try {
        ev = JSON.parse(msg.data) as AgentEvent;
      } catch {
        return;
      }
      setEvents((prev) => [...prev, ev]);

      if (ev.agent === "orchestrator" && ev.phase === "completed") {
        setSnapshot(ev.payload as RunSnapshot);
        setStatus("done");
        es.close();
      } else if (ev.agent === "orchestrator" && ev.phase === "error") {
        setError(ev.message);
        setStatus("error");
        es.close();
      } else {
        setStatus((s) =>
          s === "done" || s === "error" ? s : STATUS_BY_AGENT[ev.agent] ?? s,
        );
      }
    };

    es.onerror = () => {
      // Server closes the stream after the terminal event — stop reconnecting.
      es.close();
    };
  }, []);

  const running =
    status !== "idle" && status !== "done" && status !== "error";

  return { status, events, snapshot, error, running, start };
}
