import {
  orderDigest,
  TERMINAL_STATES,
  type EffectName,
  type SwitchEvent,
  type SwitchMachineState,
  type SwitchOrder,
  type SwitchResult,
  type SwitchState,
} from "@/lib/domain/switch";
import type { AuditEntry } from "@/lib/domain/action";
import type { LoginProofResult } from "@/lib/domain/login-proof";

/**
 * PURE, total, synchronous state machine for a Stage-2 switch. Leaf module:
 * imports only domain types — no I/O, no Date, no env, no sandbox. This is the
 * safety unit under test: NEW-before-OLD ordering (C7), rollback-leaves-old-
 * untouched, two-phase consent (C6), and the `oldSubscriptionCancelled`-only-
 * on-proof rule (C8) are all VALUE TESTS over this function.
 *
 * `cancelling_old` is reachable ONLY from `awaiting_consent_cancel`, itself
 * reachable ONLY from `verifying_new` on `VERIFY_NEW_OK` — there is no graph
 * edge that cancels before the replacement is verified.
 */

export function initialState(order: SwitchOrder): SwitchMachineState {
  return {
    state: "awaiting_consent_provision",
    order,
    expectedDigest: orderDigest(order),
    log: [],
  };
}

export function isTerminal(state: SwitchMachineState): boolean {
  return (TERMINAL_STATES as readonly SwitchState[]).includes(state.state);
}

/** The effect the driver should run next, or `null` when terminal. */
export function nextEffect(state: SwitchMachineState): EffectName | null {
  switch (state.state) {
    case "planned":
    case "awaiting_consent_provision":
      return "await_consent_provision";
    case "provisioning_new":
      return "provision";
    case "verifying_new":
      return "verify_new";
    case "awaiting_consent_cancel":
      return "await_consent_cancel";
    case "cancelling_old":
      return "cancel_old";
    case "awaiting_2fa":
      return "await_2fa";
    case "verifying_cancel":
      return "verify_cancel";
    default:
      return null; // terminal
  }
}

function normPlan(s: string): string {
  return s.trim().toLowerCase();
}

/** New account is active in the target country with the expected plan. */
export function verifyNewPassed(
  proof: LoginProofResult,
  order: SwitchOrder,
  live: boolean,
): boolean {
  return (
    proof.loggedIn &&
    normPlan(proof.currentPlan) === normPlan(order.expectedPlan) &&
    proof.billingCountry.toUpperCase() === order.toCountry.toUpperCase() &&
    proof.confidence >= 0.7 &&
    (!live || proof.status === "verified_live")
  );
}

/** Old plan is POSITIVELY cancelled (fresh authenticated read), not just logged out. */
export function verifyCancelPassed(proof: LoginProofResult): boolean {
  return proof.status === "subscription_cancelled";
}

function advance(
  s: SwitchMachineState,
  state: SwitchState,
  patch: Partial<SwitchMachineState> = {},
): SwitchMachineState {
  return { ...s, ...patch, state };
}

/**
 * Apply one typed event. Invalid (state, event) pairs return the state
 * unchanged (total + ignore-unknown), so a stray or replayed event can never
 * corrupt the machine. Only transitions append to the audit log.
 */
export function switchReducer(
  s: SwitchMachineState,
  event: SwitchEvent,
): SwitchMachineState {
  const log = [...s.log, event.type];
  const charged = Boolean(s.receiptRef);

  switch (s.state) {
    case "awaiting_consent_provision":
      if (event.type === "CONSENT_PROVISION_GRANTED") {
        if (event.orderDigest !== s.expectedDigest) return s; // stale/mutated → refuse
        return advance(s, "provisioning_new", { log, consentProvisionDigest: event.orderDigest });
      }
      if (event.type === "CONSENT_PROVISION_DENIED") {
        return advance(s, "rolled_back", { log, partialState: "consent_provision_denied" });
      }
      return s;

    case "provisioning_new":
      if (event.type === "PROVISION_OK") {
        return advance(s, "verifying_new", { log, receiptRef: event.receiptRef });
      }
      if (event.type === "PROVISION_FAILED") {
        return event.residualAmountMinor
          ? advance(s, "rolled_back_with_residual", { log, residualAmountMinor: event.residualAmountMinor })
          : advance(s, "rolled_back", { log });
      }
      return s;

    case "verifying_new":
      if (event.type === "VERIFY_NEW_OK") {
        return advance(s, "awaiting_consent_cancel", { log, newProof: event.proof });
      }
      if (event.type === "VERIFY_NEW_FAILED") {
        // Provision already happened → money may be at risk; old stays untouched.
        return charged
          ? advance(s, "rolled_back_with_residual", {
              log,
              newProof: event.proof,
              residualAmountMinor: s.order.amountMinor,
            })
          : advance(s, "rolled_back", { log, newProof: event.proof });
      }
      return s;

    case "awaiting_consent_cancel":
      if (event.type === "CONSENT_CANCEL_GRANTED") {
        if (event.orderDigest !== s.expectedDigest) return s;
        return advance(s, "cancelling_old", { log, consentCancelDigest: event.orderDigest });
      }
      if (event.type === "CONSENT_CANCEL_DENIED") {
        // User keeps both subs — safe, but the switch did not complete.
        return advance(s, "failed", { log, partialState: "cancel_declined_paying_for_two" });
      }
      return s;

    case "cancelling_old":
      if (event.type === "TWOFA_REQUIRED") {
        return advance(s, "awaiting_2fa", { log, twoFaRequired: true });
      }
      if (event.type === "CANCEL_OK") {
        return advance(s, "verifying_cancel", { log });
      }
      if (event.type === "CANCEL_FAILED") {
        return advance(s, "failed", { log, partialState: "cancel_failed_old_active" });
      }
      return s;

    case "awaiting_2fa":
      if (event.type === "TWOFA_SUBMITTED") {
        return advance(s, "cancelling_old", { log });
      }
      if (event.type === "TWOFA_EXPIRED") {
        // Re-probe the old account — the truth comes from verify_cancel.
        return advance(s, "verifying_cancel", { log, partialState: "twofa_expired" });
      }
      return s;

    case "verifying_cancel":
      if (event.type === "VERIFY_CANCEL_OK") {
        return advance(s, "done", { log, oldProof: event.proof });
      }
      if (event.type === "VERIFY_CANCEL_FAILED") {
        return advance(s, "failed", {
          log,
          oldProof: event.proof,
          partialState: "old_still_active_paying_for_two",
        });
      }
      return s;

    default:
      return s; // terminal states ignore all events
  }
}

/** Map a finished machine state to the redacted `SwitchResult` (pure). */
export function toSwitchResult(
  s: SwitchMachineState,
  switchId: string,
  audit: readonly AuditEntry[],
): SwitchResult {
  const oldCancelled =
    s.state === "done" && s.oldProof?.status === "subscription_cancelled";
  const status =
    s.state === "done"
      ? s.order.dryRun
        ? "dry_run"
        : "executed"
      : s.state === "rolled_back"
        ? "skipped"
        : "failed";
  return {
    switchId,
    subscriptionId: s.order.subscriptionId,
    state: s.state,
    status,
    dryRun: s.order.dryRun,
    receiptRef: s.receiptRef,
    newAccountRegion: s.newProof ? s.order.toCountry.toUpperCase() : undefined,
    oldSubscriptionCancelled: oldCancelled,
    newProofAfter: s.newProof,
    oldProofAfter: s.oldProof,
    residualAmountMinor: s.residualAmountMinor,
    partialState: s.partialState,
    audit,
  };
}
