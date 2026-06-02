import type { AuditEntry } from "@/lib/domain/action";
import type { Money } from "@/lib/domain/money";
import type { GiftCardOrder, PaymentProvider, PurchaseReceipt } from "./types";

/**
 * Mock Bitrefill: produces a believable gift-card SKU + receipt and a full
 * audit trail, without moving real money. Swap in BitrefillPayment (same
 * interface) to go live.
 */
export class MockPayment implements PaymentProvider {
  async quote(order: GiftCardOrder): Promise<Money> {
    // Crypto settlement ≈ face value + ~1.5% network/spread.
    return {
      amountMinor: Math.round(order.amount.amountMinor * 1.015),
      currency: order.amount.currency,
    };
  }

  async purchase(order: GiftCardOrder, dryRun: boolean): Promise<PurchaseReceipt> {
    const now = () => new Date().toISOString();
    const sku = `BITREFILL-${order.service.toUpperCase()}-${order.country.toUpperCase()}`;
    const ref = `mock-rcpt-${Math.abs(hash(sku + now())).toString(36)}`;
    const audit: AuditEntry[] = [
      { at: now(), step: "quote", detail: `Quoted ${sku} via Bitrefill (mock)` },
      {
        at: now(),
        step: "pay",
        detail: dryRun
          ? "DRY RUN — no crypto payment sent"
          : "Crypto payment settled (mock)",
      },
      {
        at: now(),
        step: "redeem",
        detail: `Gift-card code issued for ${order.country.toUpperCase()} (mock)`,
      },
    ];
    return {
      status: dryRun ? "dry_run" : "executed",
      giftCardSku: sku,
      receiptRef: ref,
      audit,
    };
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
