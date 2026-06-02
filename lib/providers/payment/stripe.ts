import "server-only";
import Stripe from "stripe";
import type { SessionUser } from "@/lib/auth";
import { getPaymentMethod } from "@/lib/db/repo";

let client: Stripe | null = null;

/** Lazily-initialized Stripe client (null when no secret key — demo mode). */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}

/** True when Stripe is fully configured for the card-capture UI. */
export function hasStripe(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  );
}

/** Reuse the user's existing Stripe customer, else create one. */
export async function getOrCreateCustomer(
  user: SessionUser | null,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;
  if (user) {
    const saved = await getPaymentMethod(user.id);
    if (saved?.stripeCustomerId) return saved.stripeCustomerId;
    const c = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    return c.id;
  }
  const c = await stripe.customers.create({ metadata: { guest: "true" } });
  return c.id;
}

/** SetupIntent for saving a card off-session (returns the client secret). */
export async function createSetupIntent(customerId: string): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe not configured");
  const si = await stripe.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    payment_method_types: ["card"],
  });
  if (!si.client_secret) throw new Error("No client secret from Stripe");
  return si.client_secret;
}

export async function retrievePaymentMethod(
  id: string,
): Promise<{ brand: string | null; last4: string | null }> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe not configured");
  const pm = await stripe.paymentMethods.retrieve(id);
  return { brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null };
}
