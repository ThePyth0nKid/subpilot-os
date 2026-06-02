import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceSlugSchema } from "@/lib/domain/subscription";
import { authEnabled, getUser } from "@/lib/auth";
import { runActions, type ActOrder } from "@/lib/agents/action";

export const runtime = "nodejs";
export const maxDuration = 120;

const OrderSchema = z.object({
  subscriptionId: z.string(),
  service: ServiceSlugSchema,
  country: z.string().length(2),
  oldCountry: z.string().length(2).optional(),
  amountMinor: z.number().int(),
  currency: z.string().length(3),
});

const BodySchema = z.object({
  orders: z.array(OrderSchema).min(1).max(20),
  dryRun: z.boolean().default(true),
  paymentToken: z.string().optional(),
  consent: z.boolean().optional(),
});

/**
 * Executes accepted switches, each inside its own isolated Daytona action
 * sandbox. Auth-gated; live execution requires explicit consent (else forced
 * to dry-run). The payment token only ever enters the ephemeral sandbox.
 */
export async function POST(req: Request) {
  try {
    if (authEnabled() && !(await getUser())) {
      return NextResponse.json({ error: "Sign in to execute" }, { status: 401 });
    }
    const { orders, dryRun, paymentToken, consent } = BodySchema.parse(
      await req.json(),
    );
    // Live execution requires explicit consent AND real auth — demo mode is
    // always dry-run so an open deployment can never move money.
    const effectiveDryRun = dryRun || !consent || !authEnabled();

    const actOrders: ActOrder[] = orders.map((o) => ({
      subscriptionId: o.subscriptionId,
      service: o.service,
      toCountry: o.country,
      fromCountry: o.oldCountry,
      amountMinor: o.amountMinor,
      currency: o.currency,
    }));

    const results = await runActions(actOrders, {
      dryRun: effectiveDryRun,
      paymentToken,
    });
    return NextResponse.json({ results, dryRun: effectiveDryRun });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
