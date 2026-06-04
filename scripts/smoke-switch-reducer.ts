import {
  initialState,
  isTerminal,
  nextEffect,
  switchReducer,
  toSwitchResult,
} from "@/lib/orchestrator/switch-reducer";
import {
  orderDigest,
  SwitchResultSchema,
  type SwitchEvent,
  type SwitchMachineState,
  type SwitchOrder,
} from "@/lib/domain/switch";
import {
  LoginProofResultSchema,
  type LoginProofResult,
} from "@/lib/domain/login-proof";
import { assertNoCode, assertNoSecrets } from "@/lib/verify/redact";

/**
 * PURE, zero-env CI gate (no sandbox, no network, no keys, no `_setup` import).
 * The security proof for Stage 2: NEW-before-OLD ordering, rollback, two-phase
 * consent, digest binding, the 2FA path, and the no-leak guarantee are all
 * value tests over the pure reducer.
 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-switch-reducer] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-switch-reducer] ok: ${msg}`);
}

const ORDER: SwitchOrder = {
  subscriptionId: "sub_1",
  service: "youtube_premium",
  fromCountry: "DE",
  toCountry: "IN",
  expectedPlan: "Premium",
  paymentPath: "bitrefill_giftcard",
  amountMinor: 11900, // ₹119.00 (INR minor)
  currency: "INR",
  dryRun: true,
};
const DIGEST = orderDigest(ORDER);

function proof(over: Partial<LoginProofResult>): LoginProofResult {
  return LoginProofResultSchema.parse({
    service: "youtube_premium",
    status: "verified",
    loggedIn: true,
    currentPlan: "Premium",
    billingCountry: "IN",
    targetCountry: "IN",
    proxyMode: "mock",
    savingsEUR: 0,
    savingsPct: 0,
    sourceUrl: "https://www.youtube.com/paid_memberships",
    capturedAt: "2026-06-03T00:00:00.000Z",
    confidence: 0.9,
    tokenRedacted: "test:d…(redacted)",
    audit: [],
    ...over,
  });
}
const NEW_OK = proof({ billingCountry: "IN", currentPlan: "Premium" });
const CANCELLED = proof({ status: "subscription_cancelled", billingCountry: "DE", currentPlan: "Premium" });

function drive(events: readonly SwitchEvent[]): SwitchMachineState {
  return events.reduce<SwitchMachineState>(
    (s, e) => switchReducer(s, e),
    initialState(ORDER),
  );
}

// ── 1. Happy path: provision → verify-new → cancel → verify-cancel → done ──
const happy = drive([
  { type: "CONSENT_PROVISION_GRANTED", orderDigest: DIGEST },
  { type: "PROVISION_OK", receiptRef: "rcpt_1" },
  { type: "VERIFY_NEW_OK", proof: NEW_OK },
  { type: "CONSENT_CANCEL_GRANTED", orderDigest: DIGEST },
  { type: "CANCEL_OK" },
  { type: "VERIFY_CANCEL_OK", proof: CANCELLED },
]);
assert(happy.state === "done", "happy path reaches done");
assert(isTerminal(happy) && nextEffect(happy) === null, "done is terminal");

// ── 2. C7 NEW-before-OLD: provision+verify strictly before any cancel ──
const iProvision = happy.log.indexOf("PROVISION_OK");
const iVerifyNew = happy.log.indexOf("VERIFY_NEW_OK");
const iCancel = happy.log.indexOf("CANCEL_OK");
assert(iProvision >= 0 && iVerifyNew > iProvision && iCancel > iVerifyNew, "PROVISION_OK < VERIFY_NEW_OK < CANCEL_OK");

// ── 3. nextEffect never selects an old-account effect before verify-new ──
const preCancelStates = [
  "awaiting_consent_provision",
  "provisioning_new",
  "verifying_new",
] as const;
for (const st of preCancelStates) {
  const eff = nextEffect({ ...initialState(ORDER), state: st });
  assert(eff !== "cancel_old" && eff !== "verify_cancel", `nextEffect(${st}) never cancels old`);
}

// ── 4. oldSubscriptionCancelled timing: false until VERIFY_CANCEL_OK ──
const beforeCancel = drive([
  { type: "CONSENT_PROVISION_GRANTED", orderDigest: DIGEST },
  { type: "PROVISION_OK", receiptRef: "rcpt_1" },
  { type: "VERIFY_NEW_OK", proof: NEW_OK },
  { type: "CONSENT_CANCEL_GRANTED", orderDigest: DIGEST },
  { type: "CANCEL_OK" },
]);
assert(toSwitchResult(beforeCancel, "sw_1", []).oldSubscriptionCancelled === false, "oldSubscriptionCancelled false before verify-cancel");
assert(toSwitchResult(happy, "sw_1", []).oldSubscriptionCancelled === true, "oldSubscriptionCancelled true only after VERIFY_CANCEL_OK");

// ── 5. VERIFY_NEW_FAILED → rollback, OLD UNTOUCHED, no cancel effect ──
const rolledResidual = drive([
  { type: "CONSENT_PROVISION_GRANTED", orderDigest: DIGEST },
  { type: "PROVISION_OK", receiptRef: "rcpt_1" },
  { type: "VERIFY_NEW_FAILED" },
]);
assert(rolledResidual.state === "rolled_back_with_residual", "charged + verify-new fail → rolled_back_with_residual");
assert(rolledResidual.residualAmountMinor === ORDER.amountMinor, "residual carries the charged amount");
assert(!rolledResidual.log.includes("CANCEL_OK"), "rollback never cancelled the old plan");
assert(nextEffect(rolledResidual) === null, "rolled_back_with_residual is terminal");

const provFailed = drive([
  { type: "CONSENT_PROVISION_GRANTED", orderDigest: DIGEST },
  { type: "PROVISION_FAILED" },
]);
assert(provFailed.state === "rolled_back", "provision fail (no charge) → rolled_back");

// ── 6. Two-phase consent ──
const provDenied = drive([{ type: "CONSENT_PROVISION_DENIED" }]);
assert(provDenied.state === "rolled_back" && !provDenied.receiptRef, "deny provision consent → rolled_back, never provisioned");
const cancelDenied = drive([
  { type: "CONSENT_PROVISION_GRANTED", orderDigest: DIGEST },
  { type: "PROVISION_OK", receiptRef: "rcpt_1" },
  { type: "VERIFY_NEW_OK", proof: NEW_OK },
  { type: "CONSENT_CANCEL_DENIED" },
]);
assert(cancelDenied.state === "failed" && isTerminal(cancelDenied), "deny cancel consent → safe terminal (both subs active)");
assert(toSwitchResult(cancelDenied, "sw", []).oldSubscriptionCancelled === false, "cancel-denied leaves old untouched");

// ── 7. Consent digest binding: a mismatched digest does not advance ──
const badDigest = switchReducer(initialState(ORDER), { type: "CONSENT_PROVISION_GRANTED", orderDigest: "deadbeef" });
assert(badDigest.state === "awaiting_consent_provision", "mismatched consent digest does not advance");

// ── 8. 2FA path ──
const twoFa = drive([
  { type: "CONSENT_PROVISION_GRANTED", orderDigest: DIGEST },
  { type: "PROVISION_OK", receiptRef: "rcpt_1" },
  { type: "VERIFY_NEW_OK", proof: NEW_OK },
  { type: "CONSENT_CANCEL_GRANTED", orderDigest: DIGEST },
  { type: "TWOFA_REQUIRED" },
  { type: "TWOFA_SUBMITTED" },
  { type: "CANCEL_OK" },
  { type: "VERIFY_CANCEL_OK", proof: CANCELLED },
]);
assert(twoFa.state === "done", "2FA path completes (required → submitted → cancel → verify → done)");
const twoFaExpired = drive([
  { type: "CONSENT_PROVISION_GRANTED", orderDigest: DIGEST },
  { type: "PROVISION_OK", receiptRef: "rcpt_1" },
  { type: "VERIFY_NEW_OK", proof: NEW_OK },
  { type: "CONSENT_CANCEL_GRANTED", orderDigest: DIGEST },
  { type: "TWOFA_REQUIRED" },
  { type: "TWOFA_EXPIRED" },
  { type: "VERIFY_CANCEL_FAILED" },
]);
assert(twoFaExpired.state === "failed", "2FA expiry → re-probe → failed (old still active)");

// ── 9. No-leak: secrets never present; injecting one throws ──
const result = SwitchResultSchema.parse(toSwitchResult(happy, "sw_leak", []));
const SECRETS = ["oldcookie-abcdef1234567890", "newcookie-zyxwvu0987654321", "pt-paymenttoken-secret99", "brightdata-password-secret"];
const CODE = "424242";
assertNoSecrets(SECRETS, result); // must NOT throw
assertNoCode(CODE, result); // must NOT throw
assert(!JSON.stringify(result).includes(SECRETS[0]), "serialized result holds no raw secret");
let threwSecret = false;
try {
  assertNoSecrets(SECRETS, { leak: SECRETS[0] });
} catch {
  threwSecret = true;
}
assert(threwSecret, "assertNoSecrets throws when a raw secret leaks");
let threwCode = false;
try {
  assertNoCode(CODE, { leak: CODE });
} catch {
  threwCode = true;
}
assert(threwCode, "assertNoCode throws when a raw 2FA code leaks");

// ── 10. Stray/replayed events are ignored (total reducer) ──
const replayed = switchReducer(happy, { type: "CANCEL_OK" });
assert(replayed.state === "done", "events after terminal are ignored");

console.log("[smoke-switch-reducer] PASS");
