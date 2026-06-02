"use client";

import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useEffect, useMemo, useState } from "react";

export interface SavedCard {
  readonly brand: string | null;
  readonly last4: string | null;
  readonly id: string;
}

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

interface CardFormProps {
  readonly onSaved: (card: SavedCard) => void;
}

/** Stripe Elements card-capture (test mode). PAN never touches our server. */
export function CardForm({ onSaved }: CardFormProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stripePromise = useMemo(
    () => (PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null),
    [],
  );

  useEffect(() => {
    fetch("/api/stripe/setup-intent", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        setClientSecret(d.clientSecret ?? null);
        setCustomerId(d.customerId ?? null);
      })
      .catch(() => setError("Could not initialize Stripe"));
  }, []);

  if (!PUBLISHABLE_KEY) {
    return (
      <div className="mono" style={{ fontSize: 12, color: "var(--ink-faint)" }}>
        Stripe not configured — add STRIPE keys to enable card capture.
      </div>
    );
  }
  if (error) {
    return (
      <div className="mono" style={{ fontSize: 12, color: "var(--red)" }}>
        ✕ {error}
      </div>
    );
  }
  if (!clientSecret || !stripePromise) {
    return (
      <div className="mono" style={{ fontSize: 12, color: "var(--ink-faint)" }}>
        Initializing secure card form…
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance: { theme: "night", labels: "floating" } }}
    >
      <CardInner customerId={customerId} onSaved={onSaved} />
    </Elements>
  );
}

function CardInner({
  customerId,
  onSaved,
}: {
  customerId: string | null;
  onSaved: (card: SavedCard) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (error) {
      setErr(error.message ?? "Card could not be saved");
      setBusy(false);
      return;
    }
    const pm = setupIntent?.payment_method;
    const pmId = typeof pm === "string" ? pm : (pm?.id ?? null);
    if (pmId && customerId) {
      try {
        const res = await fetch("/api/stripe/payment-method", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId, paymentMethodId: pmId }),
        });
        const d = await res.json();
        onSaved({ brand: d.brand ?? null, last4: d.last4 ?? null, id: pmId });
      } catch {
        onSaved({ brand: null, last4: null, id: pmId });
      }
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <PaymentElement />
      {err && (
        <div className="mono" style={{ fontSize: 12, color: "var(--red)" }}>
          ✕ {err}
        </div>
      )}
      <button className="btn btn-gold" onClick={submit} disabled={busy || !stripe}>
        {busy ? "Saving…" : "Save test card"}
      </button>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>
        Test mode · use 4242 4242 4242 4242 · any future date · any CVC
      </div>
    </div>
  );
}
