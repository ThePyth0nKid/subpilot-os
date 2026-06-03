import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@/lib/domain/events";
import { assertNoSecrets } from "@/lib/verify/redact";
import type { SwitchState } from "@/lib/domain/switch";

/**
 * True when WorkOS auth is configured. Mirrors `lib/auth.ts:authEnabled` but
 * reads `process.env` directly so this store has NO `server-only` dependency
 * and stays runnable from a `tsx` smoke.
 */
function authEnabled(): boolean {
  return Boolean(
    process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      process.env.WORKOS_COOKIE_PASSWORD,
  );
}

/**
 * In-memory switch store — mirrors `orchestrator/store.ts` (unguessable id,
 * immutable event append, pub/sub with replay, TTL eviction) and ADDS the HITL
 * machinery: one-shot consent/2FA resume gates, a per-switch async mutex, and
 * fail-closed ownership. Holds NO raw secret: the record is redacted, the
 * gates hold a secret only transiently in a closure until consumed, and
 * `emitSwitch` runs `assertNoSecrets` before any append/broadcast (C2).
 * Single-process; live runs require Postgres for durability (see repo.ts).
 */

type Listener = (event: AgentEvent) => void;

export interface ConsentResolution {
  readonly approved: boolean;
  readonly digest?: string;
}
export interface TwoFaResolution {
  /** The submitted code, or null on timeout/expiry. Consumed immediately. */
  readonly code: string | null;
}

interface Gate<T> {
  resolve: (value: T) => void;
  timer: ReturnType<typeof setTimeout>;
  consumed: boolean;
}

interface SwitchRecord {
  readonly id: string;
  readonly userId?: string;
  state: SwitchState;
  events: readonly AgentEvent[];
  readonly listeners: Set<Listener>;
  terminal: boolean;
}

interface GateSet {
  consentProvision?: Gate<ConsentResolution>;
  consentCancel?: Gate<ConsentResolution>;
  twoFa?: Gate<TwoFaResolution>;
}

const records = new Map<string, SwitchRecord>();
const gates = new Map<string, GateSet>(); // secrets live here transiently, never serialized
const locks = new Map<string, Promise<unknown>>();
const TTL_MS = 30 * 60 * 1000;

/**
 * Create a switch. FAIL-CLOSED: refuses (returns null) when auth is enabled but
 * no owner is supplied — a money-moving switch must never be unowned (C9).
 */
export function createSwitch(userId: string | undefined): string | null {
  if (authEnabled() && !userId) return null;
  const id = `switch_${randomUUID()}`;
  records.set(id, {
    id,
    userId,
    state: "awaiting_consent_provision",
    events: [],
    listeners: new Set(),
    terminal: false,
  });
  gates.set(id, {});
  return id;
}

export function ownerOf(id: string): string | undefined {
  return records.get(id)?.userId;
}
export function switchExists(id: string): boolean {
  return records.has(id);
}
export function setSwitchState(id: string, state: SwitchState): void {
  const r = records.get(id);
  if (r) r.state = state;
}
export function getSwitchSnapshot(
  id: string,
): { state: SwitchState; events: readonly AgentEvent[]; terminal: boolean } | null {
  const r = records.get(id);
  return r ? { state: r.state, events: r.events, terminal: r.terminal } : null;
}

/** Append + broadcast an event — `assertNoSecrets` first so no secret escapes. */
export function emitSwitch(
  id: string,
  event: AgentEvent,
  secrets: readonly string[],
): void {
  const r = records.get(id);
  if (!r) return;
  assertNoSecrets(secrets, event);
  r.events = [...r.events, event];
  for (const listener of r.listeners) listener(event);
}

export function subscribeSwitch(id: string, listener: Listener): () => void {
  const r = records.get(id);
  if (!r) return () => {};
  r.listeners.add(listener);
  for (const event of r.events) listener(event); // replay buffered (sync, no interleave)
  return () => {
    r.listeners.delete(listener);
  };
}

export function markSwitchTerminal(id: string): void {
  const r = records.get(id);
  if (!r) return;
  r.terminal = true;
  setTimeout(() => {
    records.delete(id);
    gates.delete(id);
    locks.delete(id);
  }, TTL_MS);
}

/** Per-switch async mutex: a resume can never overlap an in-flight effect. */
export async function withSwitchLock<R>(
  id: string,
  fn: () => Promise<R>,
): Promise<R> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    id,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

// ── Consent gates (one-shot, TTL-bounded) ─────────────────────────────────
function park<T>(timeoutMs: number, onTimeout: T): Gate<T> & { promise: Promise<T> } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  const gate = { resolve, consumed: false } as Gate<T> & { promise: Promise<T> };
  gate.promise = promise;
  gate.timer = setTimeout(() => {
    if (!gate.consumed) {
      gate.consumed = true;
      resolve(onTimeout);
    }
  }, timeoutMs);
  return gate;
}

/** Park until consent (or timeout = deny). Returns the resolution promise. */
export function awaitConsent(
  id: string,
  phase: "provision" | "cancel",
  timeoutMs = 10 * 60 * 1000,
): Promise<ConsentResolution> {
  const g = gates.get(id);
  if (!g) return Promise.resolve({ approved: false });
  const gate = park<ConsentResolution>(timeoutMs, { approved: false });
  if (phase === "provision") g.consentProvision = gate;
  else g.consentCancel = gate;
  return gate.promise;
}

export type SubmitOutcome = "ok" | "forbidden" | "conflict";

/**
 * Resolve a consent gate. Single-consumption under fail-closed ownership:
 * ownership-check → compare-and-set (consumed flag) → resolve. A replay or a
 * submit with no live waiter returns "conflict" (the route maps it to 409).
 */
export function submitConsent(
  id: string,
  phase: "provision" | "cancel",
  approved: boolean,
  digest: string,
  userId: string | undefined,
): SubmitOutcome {
  if (authEnabled() && ownerOf(id) !== userId) return "forbidden";
  const g = gates.get(id);
  if (!g) return "conflict";
  const gate = phase === "provision" ? g.consentProvision : g.consentCancel;
  if (!gate || gate.consumed) return "conflict";
  gate.consumed = true; // flip FIRST
  clearTimeout(gate.timer);
  if (phase === "provision") g.consentProvision = undefined;
  else g.consentCancel = undefined;
  gate.resolve({ approved, digest });
  return "ok";
}

// ── 2FA gate (one-shot, shorter TTL than provider codes) ──────────────────
export function awaitTwoFa(
  id: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<TwoFaResolution> {
  const g = gates.get(id);
  if (!g) return Promise.resolve({ code: null });
  const gate = park<TwoFaResolution>(timeoutMs, { code: null });
  g.twoFa = gate;
  return gate.promise;
}

export function submitTwoFa(
  id: string,
  code: string,
  userId: string | undefined,
): SubmitOutcome {
  if (authEnabled() && ownerOf(id) !== userId) return "forbidden";
  const g = gates.get(id);
  if (!g || !g.twoFa || g.twoFa.consumed) return "conflict";
  const gate = g.twoFa;
  gate.consumed = true;
  clearTimeout(gate.timer);
  g.twoFa = undefined;
  gate.resolve({ code }); // code travels in the closure only; never stored on the record
  return "ok";
}
