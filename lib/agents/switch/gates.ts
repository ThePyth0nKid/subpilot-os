import type { OptimizationResult } from "@/lib/domain/recommendation";
import type { Subscription } from "@/lib/domain/subscription";
import {
  SwitchOrderSchema,
  type SwitchOrder,
} from "@/lib/domain/switch";

/**
 * Pure live-vs-dry gating + order construction — no sandboxes, no env reads, so
 * it is unit-testable on its own. The real effects compute these inputs from
 * env + providers + the resolved consent and call {@link assertLiveAllowed}
 * INSIDE the money-moving step, so no caller (route, CLI, MCP) can charge
 * without every gate (threat-model C9/C10).
 */
export interface LiveGateInputs {
  readonly liveFlag: boolean; // SUBPILOT_LIVE_SWITCH === "1"
  readonly consentProvision: boolean; // provision-phase consent resolved true
  readonly authEnabled: boolean;
  readonly hasUser: boolean;
  readonly hasBrightData: boolean;
  readonly hasProxyCidr: boolean; // BRIGHTDATA_PROXY_CIDR present
  readonly paymentIsBitrefill: boolean; // real provider, not MockPayment
  readonly realToken: boolean; // a non-"test:"-prefixed session token
  readonly hasDatabase: boolean; // DATABASE_URL present (durable breadcrumb)
}

/** True only when EVERY fail-closed condition holds. Missing any ⇒ dry-run. */
export function liveAllowed(i: LiveGateInputs): boolean {
  return (
    i.liveFlag &&
    i.consentProvision &&
    i.authEnabled &&
    i.hasUser &&
    i.hasBrightData &&
    i.hasProxyCidr &&
    i.paymentIsBitrefill &&
    i.realToken &&
    i.hasDatabase
  );
}

export function assertLiveAllowed(i: LiveGateInputs): void {
  if (!liveAllowed(i)) {
    throw new Error(
      "live switch refused — not all fail-closed gates are satisfied " +
        "(need: live flag, provision consent, auth+user, Bright Data + proxy CIDR, " +
        "real payment provider, real session token, DATABASE_URL).",
    );
  }
}

/**
 * Build switch orders from a completed optimization. One order per viable
 * recommendation with a chosen cheaper country and a real payment path.
 * `fromCountry` is taken explicitly from the subscription's detected country
 * (never a "home" default). `dryRun` starts true; the agent flips it only when
 * the full live gate passes.
 */
export function buildSwitchOrders(
  optimization: OptimizationResult,
  subsById: ReadonlyMap<string, Subscription>,
): readonly SwitchOrder[] {
  const orders: SwitchOrder[] = [];
  for (const rec of optimization.recommendations) {
    if (!rec.viable || rec.chosen === null) continue;
    if (rec.paymentPath === "none") continue;
    const sub = subsById.get(rec.subscriptionId);
    if (!sub) continue;
    orders.push(
      SwitchOrderSchema.parse({
        subscriptionId: rec.subscriptionId,
        service: rec.service,
        fromCountry: sub.detectedCountry.toUpperCase().slice(0, 2),
        toCountry: rec.chosen.country.toUpperCase().slice(0, 2),
        expectedPlan: rec.chosen.planName,
        paymentPath: rec.paymentPath,
        amountMinor: rec.chosen.price.amountMinor,
        currency: rec.chosen.price.currency,
        dryRun: true,
      } satisfies SwitchOrder),
    );
  }
  return orders;
}
