import type { AuditEntry } from "@/lib/domain/action";
import type { Money } from "@/lib/domain/money";
import type { ServiceSlug } from "@/lib/domain/subscription";

export interface GiftCardOrder {
  readonly service: ServiceSlug;
  readonly country: string; // ISO-2 target region
  readonly amount: Money;
}

/**
 * Result of a payment attempt. The Action agent assembles the full ActionResult
 * (with subscriptionId + cancellation); the provider only owns the purchase.
 */
export interface PurchaseReceipt {
  readonly status: "dry_run" | "executed" | "failed";
  readonly giftCardSku?: string;
  readonly receiptRef?: string;
  readonly audit: readonly AuditEntry[];
  readonly error?: string;
}

export interface PaymentProvider {
  /** Crypto/settlement price for the gift-card order. */
  quote(order: GiftCardOrder): Promise<Money>;
  /** Buy the gift card (dryRun = simulate, no real money moves). */
  purchase(order: GiftCardOrder, dryRun: boolean): Promise<PurchaseReceipt>;
}
