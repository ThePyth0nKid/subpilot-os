import type { ActionResult } from "@/lib/domain/action";
import { runActionInSandbox } from "@/lib/daytona/action-sandbox";
import { emitter, type OnEvent } from "@/lib/agents/emit";

export interface ActOrder {
  readonly subscriptionId: string;
  readonly service: string;
  readonly toCountry: string;
  readonly fromCountry?: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface ActArgs {
  readonly dryRun: boolean;
  readonly paymentToken?: string;
  readonly runId?: string;
  readonly onEvent?: OnEvent;
}

/**
 * ACTION AGENT — provisions each accepted switch inside its OWN ephemeral
 * Daytona sandbox (where the scoped payment token is isolated), assembling an
 * audited ActionResult. Sandboxes run in parallel (orders are few).
 */
export async function runActions(
  orders: readonly ActOrder[],
  { dryRun, paymentToken, runId = "local", onEvent }: ActArgs,
): Promise<readonly ActionResult[]> {
  const emit = emitter("action", runId, onEvent);
  emit(
    "started",
    `Provisioning ${orders.length} switch${orders.length === 1 ? "" : "es"} in isolated sandboxes…`,
  );

  return Promise.all(
    orders.map(async (o): Promise<ActionResult> => {
      emit("progress", `Action sandbox · ${o.service} → ${o.toCountry}`, {
        country: o.toCountry,
      });
      try {
        const r = await runActionInSandbox({
          service: o.service,
          fromCountry: o.fromCountry ?? "home",
          toCountry: o.toCountry,
          amountMinor: o.amountMinor,
          currency: o.currency,
          paymentToken,
          dryRun,
        });
        const at = new Date().toISOString();
        emit(
          "completed",
          `${o.service} → ${o.toCountry} provisioned in sandbox ${r.sandboxId.slice(0, 8)}`,
          { country: o.toCountry, sandboxId: r.sandboxId },
        );
        return {
          subscriptionId: o.subscriptionId,
          status: dryRun ? "dry_run" : "executed",
          dryRun,
          giftCardSku: r.giftCardSku,
          receiptRef: `sbx-${r.sandboxId.slice(0, 8)}`,
          newAccountRegion: o.toCountry,
          oldSubscriptionCancelled: !dryRun,
          audit: r.steps.map((s) => ({ at, step: s.step, detail: s.detail })),
        };
      } catch (err) {
        emit("error", `Action failed for ${o.service}`, { country: o.toCountry });
        return {
          subscriptionId: o.subscriptionId,
          status: "failed",
          dryRun,
          oldSubscriptionCancelled: false,
          audit: [],
          error: err instanceof Error ? err.message : "action failed",
        };
      }
    }),
  );
}
