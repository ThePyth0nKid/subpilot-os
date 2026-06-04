import "./_setup";
import { MockProxy } from "@/lib/providers/proxy/mock";
import { MockPayment } from "@/lib/providers/payment/mock";
import { orderDigest, type SwitchOrder } from "@/lib/domain/switch";
import {
  createSwitch,
  getSwitchSnapshot,
  submitConsent,
  subscribeSwitch,
} from "@/lib/orchestrator/switch-store";
import { makeRealEffects } from "@/lib/agents/switch/effects";
import { runSwitch } from "@/lib/agents/switch";

/**
 * INTEGRATION smoke — drives a FULL dry-run switch through REAL Daytona
 * sandboxes (provision → verify-new → cancel → verify-cancel) with the MOCK
 * proxy + MOCK payment + deterministic fixtures + `test:` tokens. Proves the
 * wiring + the two-phase consent pause/resume end-to-end while moving NO money
 * and cancelling NOTHING. Requires DAYTONA_API_KEY (+ ANTHROPIC) in .env.local.
 */
const NEW_FIXTURE = `<!doctype html><html><body data-sp-auth="true">
  <div data-sp-plan="Premium"></div><div data-sp-billing-country="IN"></div></body></html>`;
const CANCELLED_FIXTURE = `<!doctype html><html><body data-sp-auth="true">
  <div data-sp-plan="Premium"></div><div data-sp-billing-country="DE"></div>
  <div data-sp-cancelled="true">Your membership ends on June 30.</div></body></html>`;

const ORDER: SwitchOrder = {
  subscriptionId: "sub_live_1",
  service: "youtube_premium",
  fromCountry: "DE",
  toCountry: "IN",
  expectedPlan: "Premium",
  paymentPath: "bitrefill_giftcard",
  amountMinor: 11900,
  currency: "INR",
  dryRun: true,
};

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-switch-live] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-switch-live] ok: ${msg}`);
}

async function main() {
  const switchId = createSwitch(undefined); // demo mode (no auth) → owned by nobody
  assert(switchId !== null, "createSwitch returns an id in demo mode");
  const id = switchId as string;
  const digest = orderDigest(ORDER);

  const log: string[] = [];
  subscribeSwitch(id, (e) => {
    log.push(`${e.phase}:${e.message}`);
    console.log(`  · [${e.phase}] ${e.message}`);
  });

  // Auto-approve both consent gates as soon as the driver parks on them.
  const auto = setInterval(() => {
    const snap = getSwitchSnapshot(id);
    if (!snap) return;
    if (snap.state === "awaiting_consent_provision") submitConsent(id, "provision", true, digest, undefined);
    else if (snap.state === "awaiting_consent_cancel") submitConsent(id, "cancel", true, digest, undefined);
  }, 150);

  const effects = makeRealEffects({
    proxy: new MockProxy(),
    payment: new MockPayment(),
    newAccountFixtureHtml: NEW_FIXTURE,
    cancelledFixtureHtml: CANCELLED_FIXTURE,
  });

  const result = await runSwitch(ORDER, effects, {
    switchId: id,
    oldSessionToken: "test:old-account-cookie",
  });
  clearInterval(auto);

  const serialized = JSON.stringify(result);
  assert(result.state === "done", "full dry-run switch reaches done");
  assert(result.status === "dry_run", "status is dry_run (no money moved)");
  assert(result.oldSubscriptionCancelled === true, "old subscription cancelled (proven by verify-cancel)");
  assert(result.newProofAfter?.loggedIn === true, "new account verified active");
  assert(result.oldProofAfter?.status === "subscription_cancelled", "old account shows positive cancellation marker");
  assert(!serialized.includes("test:old-account-cookie"), "raw old token absent from the result");
  assert(!serialized.includes("test:new-youtube_premium"), "raw new token absent from the result");
  // NEW-before-OLD also holds live: provision/verify-new precede any cancel message.
  const iVerifyNew = log.findIndex((m) => m.includes("new account verified active") || m.includes("Verifying the new"));
  const iCancel = log.findIndex((m) => m.includes("Cancelling the old"));
  assert(iVerifyNew >= 0 && iCancel > iVerifyNew, "verify-new precedes cancel in the live event log");

  console.log("\n[smoke-switch-live] result:\n" + JSON.stringify(result, null, 2));
  console.log("[smoke-switch-live] PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("[smoke-switch-live] FAILED:", e);
  process.exit(1);
});
