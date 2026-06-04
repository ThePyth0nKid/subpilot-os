import { NextResponse } from "next/server";
import { authEnabled, getUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/ratelimit";
import {
  createSetupIntent,
  getOrCreateCustomer,
  hasStripe,
} from "@/lib/providers/payment/stripe";

export const runtime = "nodejs";

/** Creates a SetupIntent so the client can save a test card via Stripe Elements. */
export async function POST(req: Request) {
  try {
    if (!hasStripe()) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
    }
    const user = await getUser();
    if (authEnabled() && !user) {
      return NextResponse.json({ error: "Sign in to add a card" }, { status: 401 });
    }
    // Cap SetupIntent creation per caller to deter card-testing abuse.
    const limited = enforceRateLimit(req, "stripe", user);
    if (limited) return limited;
    const customerId = await getOrCreateCustomer(user);
    if (!customerId) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
    }
    const clientSecret = await createSetupIntent(customerId);
    return NextResponse.json({
      clientSecret,
      customerId,
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Setup intent failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
