import type { AgentEvent } from "@/lib/domain/events";
import type { AuditEntry } from "@/lib/domain/action";
import {
  SwitchResultSchema,
  type SwitchEvent,
  type SwitchMachineState,
  type SwitchOrder,
  type SwitchResult,
} from "@/lib/domain/switch";
import type { OnEvent } from "@/lib/agents/emit";
import { assertNoSecrets } from "@/lib/verify/redact";
import {
  awaitConsent,
  awaitTwoFa,
  emitSwitch,
  markSwitchTerminal,
  setSwitchState,
  withSwitchLock,
} from "@/lib/orchestrator/switch-store";
import {
  initialState,
  isTerminal,
  nextEffect,
  switchReducer,
  toSwitchResult,
  verifyCancelPassed,
  verifyNewPassed,
} from "@/lib/orchestrator/switch-reducer";
import type { SwitchEffects } from "./effects";

export interface SwitchDriverDeps {
  readonly switchId: string;
  readonly userId?: string;
  /** Old-account session cookie (secret) — handed to cancel/verify effects. */
  readonly oldSessionToken: string;
  readonly onEvent?: OnEvent;
  /** Extra secrets to scrub from every emit (e.g. the Bright Data password). */
  readonly extraSecrets?: readonly string[];
}

/**
 * STAGE 2 driver. Holds ZERO ordering logic: it reads the state, runs the
 * effect `nextEffect` selects, feeds the typed result back as an event, and
 * loops until terminal. Every step runs under the per-switch mutex so a resume
 * (consent / 2FA) can never overlap an in-flight effect. The NEW-before-OLD
 * guarantee lives entirely in the pure reducer — the driver cannot violate it.
 *
 * Secrets (old cookie, new-account token from provision, the 2FA code) live in
 * locals here and are passed straight into the effects; `assertNoSecrets` runs
 * on every emitted event and on the final result.
 */
export async function runSwitch(
  order: SwitchOrder,
  effects: SwitchEffects,
  deps: SwitchDriverDeps,
): Promise<SwitchResult> {
  const now = (): string => new Date().toISOString();
  const secrets: string[] = [deps.oldSessionToken, ...(deps.extraSecrets ?? [])];
  const audit: AuditEntry[] = [];
  let newToken: string | undefined;
  let twoFaCode: string | undefined;
  let state: SwitchMachineState = initialState(order);

  const emit = (
    phase: AgentEvent["phase"],
    message: string,
    payload?: unknown,
  ): void => {
    const event: AgentEvent = {
      runId: deps.switchId,
      at: now(),
      agent: "switch",
      phase,
      message,
      ...(payload === undefined ? {} : { payload }),
    };
    assertNoSecrets(secrets, event); // C2 — never emit a secret
    emitSwitch(deps.switchId, event, secrets);
    deps.onEvent?.(event);
  };

  const reduce = (event: SwitchEvent): void => {
    state = switchReducer(state, event);
  };

  emit("started", `Switch ${order.service} ${order.fromCountry}→${order.toCountry} (${order.dryRun ? "dry-run" : "LIVE"})`);

  while (!isTerminal(state)) {
    const effect = nextEffect(state);
    if (!effect) break;

    await withSwitchLock(deps.switchId, async () => {
      switch (effect) {
        case "await_consent_provision": {
          setSwitchState(deps.switchId, "awaiting_consent_provision");
          emit("progress", "Awaiting consent to provision the new subscription…");
          const r = await awaitConsent(deps.switchId, "provision");
          reduce(
            r.approved
              ? { type: "CONSENT_PROVISION_GRANTED", orderDigest: r.digest ?? "" }
              : { type: "CONSENT_PROVISION_DENIED" },
          );
          return;
        }
        case "provision": {
          emit("progress", "Provisioning the new subscription…");
          const r = await effects.provision(order, order.dryRun);
          if (r.newToken) {
            newToken = r.newToken;
            secrets.push(r.newToken);
          }
          audit.push({
            at: now(),
            step: "provision",
            detail: r.ok ? `provisioned (${r.receiptRef ?? "no ref"})` : `provision failed: ${r.error ?? "unknown"}`,
          });
          reduce(
            r.ok && r.receiptRef
              ? { type: "PROVISION_OK", receiptRef: r.receiptRef }
              : { type: "PROVISION_FAILED", residualAmountMinor: r.residualAmountMinor },
          );
          return;
        }
        case "verify_new": {
          emit("progress", "Verifying the new subscription is active…");
          const proof = await effects.verifyNew(order, newToken ?? "");
          const pass = verifyNewPassed(proof, order, !order.dryRun);
          audit.push({
            at: now(),
            step: "verify_new",
            detail: pass ? "new account verified active" : "new account NOT verified",
          });
          if (pass) {
            reduce({ type: "VERIFY_NEW_OK", proof });
          } else {
            await effects.rollbackNew(order, newToken).catch(() => undefined);
            reduce({ type: "VERIFY_NEW_FAILED", proof });
          }
          return;
        }
        case "await_consent_cancel": {
          setSwitchState(deps.switchId, "awaiting_consent_cancel");
          emit("progress", "New subscription verified. Awaiting consent to cancel the old one…", state.newProof);
          const r = await awaitConsent(deps.switchId, "cancel");
          reduce(
            r.approved
              ? { type: "CONSENT_CANCEL_GRANTED", orderDigest: r.digest ?? "" }
              : { type: "CONSENT_CANCEL_DENIED" },
          );
          return;
        }
        case "cancel_old": {
          emit("progress", "Cancelling the old subscription…");
          const r = await effects.cancelOld(order, order.dryRun, deps.oldSessionToken, twoFaCode);
          twoFaCode = undefined; // single-use
          if (r.twoFaRequired) {
            audit.push({ at: now(), step: "cancel", detail: "2FA required" });
            reduce({ type: "TWOFA_REQUIRED" });
          } else {
            audit.push({ at: now(), step: "cancel", detail: r.ok ? "cancel submitted" : `cancel failed: ${r.error ?? "unknown"}` });
            reduce(r.ok ? { type: "CANCEL_OK" } : { type: "CANCEL_FAILED" });
          }
          return;
        }
        case "await_2fa": {
          setSwitchState(deps.switchId, "awaiting_2fa");
          emit("progress", "Awaiting 2FA code to confirm cancellation…");
          const r = await awaitTwoFa(deps.switchId);
          if (r.code) {
            twoFaCode = r.code; // closure only — never on state / event / persist
            reduce({ type: "TWOFA_SUBMITTED" });
          } else {
            reduce({ type: "TWOFA_EXPIRED" });
          }
          return;
        }
        case "verify_cancel": {
          emit("progress", "Verifying the old subscription is cancelled…");
          const proof = await effects.verifyCancel(order, deps.oldSessionToken);
          const pass = verifyCancelPassed(proof);
          audit.push({
            at: now(),
            step: "verify_cancel",
            detail: pass ? "old subscription cancelled (verified)" : "cancellation NOT verified",
          });
          reduce(pass ? { type: "VERIFY_CANCEL_OK", proof } : { type: "VERIFY_CANCEL_FAILED", proof });
          return;
        }
      }
    });

    setSwitchState(deps.switchId, state.state);
    emit("progress", `→ ${state.state}`);
  }

  const result = SwitchResultSchema.parse(toSwitchResult(state, deps.switchId, audit));
  assertNoSecrets(secrets, result);
  emit(state.state === "done" ? "completed" : "error", `switch ${state.state}`, result);
  markSwitchTerminal(deps.switchId);
  return result;
}
