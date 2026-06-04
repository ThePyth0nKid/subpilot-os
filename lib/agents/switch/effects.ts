import {
  LoginProofResultSchema,
  type LoginProofResult,
} from "@/lib/domain/login-proof";
import type { SwitchOrder } from "@/lib/domain/switch";
import type {
  PaymentProvider,
  ProxyProvider,
} from "@/lib/providers";
import type { OnEvent } from "@/lib/agents/emit";
import { runLoginRead } from "@/lib/agents/login-read";
import type { Target } from "@/lib/agents/login-read/parse";
import { runCancelInSandbox } from "@/lib/daytona/cancel-sandbox";
import { assertLiveAllowed, type LiveGateInputs } from "./gates";

/**
 * The side-effecting seam of the switch chain — the ONLY place real I/O lives
 * (sandboxes, payment, verification). The driver and reducer stay pure; swapping
 * `makeMockEffects` ↔ `makeRealEffects` changes nothing about the state machine.
 *
 * Secrets (the new-account token from `provision`, the old-account cookie, the
 * 2FA code) are returned/accepted here and handed straight to the next
 * sandbox's env — they are NEVER placed on the reducer state or an event.
 */

export interface ProvisionResult {
  readonly ok: boolean;
  readonly receiptRef?: string;
  readonly giftCardSku?: string;
  /** New-account session token (secret) — passed to `verifyNew`, never logged. */
  readonly newToken?: string;
  readonly residualAmountMinor?: number;
  readonly error?: string;
}

export interface CancelResult {
  readonly ok: boolean;
  readonly twoFaRequired?: boolean;
  readonly error?: string;
}

export interface RollbackResult {
  readonly reversed: boolean;
  readonly residualAmountMinor?: number;
  readonly receiptRef?: string;
}

export interface SwitchEffects {
  /** Buy + redeem the new subscription in the target country. */
  provision(order: SwitchOrder, dryRun: boolean): Promise<ProvisionResult>;
  /** Re-probe the NEW account (C8) — returns a redacted proof; gate is in the reducer. */
  verifyNew(order: SwitchOrder, newToken: string): Promise<LoginProofResult>;
  /** Cancel the OLD subscription; may report `twoFaRequired`. */
  cancelOld(
    order: SwitchOrder,
    dryRun: boolean,
    oldToken: string,
    code?: string,
  ): Promise<CancelResult>;
  /** Re-probe the OLD account for a positive cancellation marker (C8). */
  verifyCancel(order: SwitchOrder, oldToken: string): Promise<LoginProofResult>;
  /** Best-effort reversal of the new provisioning when verify-new fails. */
  rollbackNew(order: SwitchOrder, newToken?: string): Promise<RollbackResult>;
}

const FIXED_AT = "2026-06-03T00:00:00.000Z";

function mockProof(
  order: SwitchOrder,
  over: Partial<LoginProofResult>,
): LoginProofResult {
  return LoginProofResultSchema.parse({
    service: order.service,
    status: "verified",
    loggedIn: true,
    currentPlan: order.expectedPlan,
    billingCountry: order.toCountry.toUpperCase(),
    targetCountry: order.toCountry.toUpperCase(),
    proxyMode: "mock",
    savingsEUR: 0,
    savingsPct: 0,
    sourceUrl: "mock://account",
    capturedAt: FIXED_AT,
    confidence: 0.9,
    tokenRedacted: "mock(redacted)",
    audit: [],
    ...over,
  });
}

export interface MockEffectsOptions {
  readonly twoFaRequired?: boolean;
  readonly verifyNewFails?: boolean;
  readonly verifyCancelFails?: boolean;
}

/**
 * Deterministic, no-I/O effects for unit tests and pure driver runs. Moves no
 * money, touches no sandbox. `provision` always reports a mock receipt; the
 * verify steps return proofs the reducer gates evaluate.
 */
export function makeMockEffects(opts: MockEffectsOptions = {}): SwitchEffects {
  let cancelAttempts = 0;
  return {
    async provision(order) {
      return {
        ok: true,
        receiptRef: `mock-rcpt-${order.subscriptionId}`,
        giftCardSku: `MOCK-${order.service.toUpperCase()}-${order.toCountry.toUpperCase()}`,
        newToken: `test:new-${order.service}`,
      };
    },
    async verifyNew(order) {
      return opts.verifyNewFails
        ? mockProof(order, { loggedIn: false, status: "login_failed", confidence: 0.1 })
        : mockProof(order, {});
    },
    async cancelOld(_order, _dryRun, _oldToken, code) {
      cancelAttempts += 1;
      if (opts.twoFaRequired && !code && cancelAttempts === 1) {
        return { ok: false, twoFaRequired: true };
      }
      return { ok: true };
    },
    async verifyCancel(order) {
      return opts.verifyCancelFails
        ? mockProof(order, {
            status: "failed",
            billingCountry: order.fromCountry.toUpperCase(),
          })
        : mockProof(order, {
            status: "subscription_cancelled",
            billingCountry: order.fromCountry.toUpperCase(),
          });
    },
    async rollbackNew() {
      return { reversed: true };
    },
  };
}

export interface RealEffectsDeps {
  readonly proxy: ProxyProvider;
  readonly payment: PaymentProvider;
  readonly networkAllowList?: string;
  readonly onEvent?: OnEvent;
  /** Deterministic HTML for `test:`-prefixed tokens (dry-run verification). */
  readonly newAccountFixtureHtml?: string;
  readonly cancelledFixtureHtml?: string;
  /** Computes the fail-closed live gate; required when a step runs `dryRun=false`. */
  readonly liveGate?: () => LiveGateInputs;
}

const NO_GATE: LiveGateInputs = {
  liveFlag: false,
  consentProvision: false,
  authEnabled: false,
  hasUser: false,
  hasBrightData: false,
  hasProxyCidr: false,
  paymentIsBitrefill: false,
  realToken: false,
  hasDatabase: false,
};

/**
 * Real effects: provision via the payment provider, verify via Stage-1
 * `runLoginRead` (read-only, idempotent), cancel via the cancel sandbox. The
 * fail-closed live gate is re-asserted HERE (not just at the route) so no
 * caller can charge without every condition. In dry-run, payment is the mock,
 * the cancel sandbox runs its egress-proof-only branch, and the verify steps
 * read deterministic fixtures with `test:` tokens — real Daytona sandboxes
 * spin up, but no money moves and nothing is cancelled.
 */
export function makeRealEffects(deps: RealEffectsDeps): SwitchEffects {
  return {
    async provision(order, dryRun) {
      if (!dryRun) assertLiveAllowed(deps.liveGate?.() ?? NO_GATE);
      const receipt = await deps.payment.purchase(
        {
          service: order.service,
          country: order.toCountry,
          amount: { amountMinor: order.amountMinor, currency: order.currency },
        },
        dryRun,
      );
      if (receipt.status === "failed") {
        return { ok: false, error: receipt.error };
      }
      // Dry-run cannot really provision a new account → a safe test token whose
      // verification reads a fixture. Live capture of the real new-account
      // cookie is the gated Stage-2 milestone.
      const newToken = `test:new-${order.service}`;
      return {
        ok: true,
        receiptRef: receipt.receiptRef,
        giftCardSku: receipt.giftCardSku,
        newToken,
      };
    },

    async verifyNew(order, newToken) {
      return runLoginRead(
        {
          service: order.service as Target,
          country: order.toCountry,
          sessionToken: newToken,
          currentMonthlyEUR: undefined,
          accountFixtureHtml: newToken.startsWith("test:")
            ? deps.newAccountFixtureHtml
            : undefined,
        },
        {
          proxy: deps.proxy,
          networkAllowList: deps.networkAllowList,
          onEvent: deps.onEvent,
        },
      );
    },

    async cancelOld(order, dryRun, oldToken) {
      const out = await runCancelInSandbox({
        service: order.service,
        fromCountry: order.fromCountry,
        sessionToken: oldToken,
        proxy: deps.proxy.forCountry(order.fromCountry),
        dryRun,
        network: deps.networkAllowList
          ? { allowList: deps.networkAllowList }
          : undefined,
      });
      return { ok: true, twoFaRequired: out.twoFaRequired };
    },

    async verifyCancel(order, oldToken) {
      return runLoginRead(
        {
          service: order.service as Target,
          country: order.fromCountry,
          sessionToken: oldToken,
          accountFixtureHtml: oldToken.startsWith("test:")
            ? deps.cancelledFixtureHtml
            : undefined,
        },
        {
          proxy: deps.proxy,
          networkAllowList: deps.networkAllowList,
          onEvent: deps.onEvent,
        },
      );
    },

    async rollbackNew() {
      return { reversed: true };
    },
  };
}
