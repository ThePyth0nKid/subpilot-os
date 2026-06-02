import { NextResponse } from "next/server";
import { z } from "zod";
import { authEnabled, getUser } from "@/lib/auth";
import { getPaymentMethod, savePaymentMethod } from "@/lib/db/repo";
import { hasStripe, retrievePaymentMethod } from "@/lib/providers/payment/stripe";

export const runtime = "nodejs";

/** Returns the user's saved card (brand/last4), if any. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ paymentMethod: null });
  const pm = await getPaymentMethod(user.id);
  return NextResponse.json({
    paymentMethod: pm
      ? { brand: pm.brand, last4: pm.last4, id: pm.stripePaymentMethodId }
      : null,
  });
}

const BodySchema = z.object({
  customerId: z.string(),
  paymentMethodId: z.string(),
});

/** Persists a card after the client confirms the SetupIntent. */
export async function POST(req: Request) {
  try {
    if (!hasStripe()) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
    }
    const user = await getUser();
    if (authEnabled() && !user) {
      return NextResponse.json({ error: "Sign in" }, { status: 401 });
    }
    const { customerId, paymentMethodId } = BodySchema.parse(await req.json());
    const { brand, last4 } = await retrievePaymentMethod(paymentMethodId);
    if (user) {
      await savePaymentMethod(user.id, {
        stripeCustomerId: customerId,
        stripePaymentMethodId: paymentMethodId,
        brand,
        last4,
      });
    }
    return NextResponse.json({ brand, last4, id: paymentMethodId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save card failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
