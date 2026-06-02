import type { AgentEvent } from "@/lib/domain/events";
import type { RunStatus } from "./types";

type Listener = (event: AgentEvent) => void;

interface RunRecord {
  readonly id: string;
  readonly userId?: string;
  status: RunStatus;
  events: readonly AgentEvent[];
  readonly listeners: Set<Listener>;
  terminal: boolean;
}

/**
 * In-memory run store with a tiny pub/sub so the SSE route can stream live
 * events and replay anything a late subscriber missed. Single-process; fine
 * for the demo (a real build would back this with Redis/Durable Objects).
 */
const runs = new Map<string, RunRecord>();

function newId(): string {
  // CSPRNG — run ids must be unguessable (the SSE stream is keyed on them).
  return `run_${crypto.randomUUID()}`;
}

/** Owner (WorkOS user id) of a run, for SSE ownership checks. */
export function ownerOf(id: string): string | undefined {
  return runs.get(id)?.userId;
}

const RUN_TTL_MS = 30 * 60 * 1000;

export function createRun(userId?: string): string {
  const id = newId();
  runs.set(id, {
    id,
    userId,
    status: "idle",
    events: [],
    listeners: new Set(),
    terminal: false,
  });
  return id;
}

export function setStatus(id: string, status: RunStatus): void {
  const r = runs.get(id);
  if (r) r.status = status;
}

export function emit(id: string, event: AgentEvent): void {
  const r = runs.get(id);
  if (!r) return;
  r.events = [...r.events, event]; // immutable append
  for (const listener of r.listeners) listener(event);
}

export function markTerminal(id: string): void {
  const r = runs.get(id);
  if (!r) return;
  r.terminal = true;
  // Evict completed runs so the in-memory store can't grow without bound.
  setTimeout(() => runs.delete(id), RUN_TTL_MS);
}

/** Register a listener, replaying buffered events first (sync — no interleave). */
export function subscribe(id: string, listener: Listener): () => void {
  const r = runs.get(id);
  if (!r) return () => {};
  r.listeners.add(listener);
  for (const event of r.events) listener(event);
  return () => {
    r.listeners.delete(listener);
  };
}

export function exists(id: string): boolean {
  return runs.has(id);
}
