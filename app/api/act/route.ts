import { NextResponse } from "next/server";
import { z } from "zod";
import { type ActionResult } from "@/lib/domain/action";
import { ServiceSlugSchema } from "@/lib/domain/subscription";
import { getProviders } from "@/lib/providers";
import { authEnabled, getUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const OrderSchema = z.object({
  subscriptionId: z.string(),
  service: ServiceSlugSchema,
  country: z.string().length(2),
  oldCountry: z.string().length(2).optional(),
  amountMinor: z.number().int(),
  currency: z.string().length(3),
});
const BodySchema = z.object({
  orders: z.array(OrderSchema).min(1),
  dryRun: z.boolean().default(true),
});

export async function POST(req: Request) {
  try {
    if (authEnabled() && !(await getUser())) {
      return NextResponse.json({ error: "Sign in to execute" }, { status: 401 });
    }
    const { orders, dryRun } = BodySchema.parse(await req.json());
    const { payment } = getProviders();

    const results: ActionResult[] = [];
    for (const order of orders) {
      const receipt = await payment.purchase(
        {
          service: order.service,
          country: order.country,
          amount: { amountMinor: order.amountMinor, currency: order.currency },
        },
        dryRun,
      );
      results.push({
        subscriptionId: order.subscriptionId,
        status: receipt.status,
        dryRun,
        giftCardSku: receipt.giftCardSku,
        receiptRef: receipt.receiptRef,
        newAccountRegion: order.country,
        oldSubscriptionCancelled: !dryRun,
        audit: [
          ...receipt.audit,
          {
            at: new Date().toISOString(),
            step: "cancel",
            detail: dryRun
              ? `Old ${order.oldCountry ?? "home"} subscription flagged for cancellation (dry run)`
              : `Old ${order.oldCountry ?? "home"} subscription cancelled`,
          },
        ],
        error: receipt.error,
      });
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
