import type { Money } from "@/lib/domain/money";
import type { GiftCardOrder, PaymentProvider, PurchaseReceipt } from "./types";

export interface BitrefillConfig {
  readonly apiKey: string;
  readonly apiSecret: string;
}

const NOT_CONFIGURED =
  "Bitrefill is not configured. Provide BITREFILL_API_KEY and BITREFILL_API_SECRET to enable real purchases.";

/** Real Bitrefill gift-card purchase via crypto. Stub until credentials exist. */
export class BitrefillPayment implements PaymentProvider {
  constructor(private readonly cfg: BitrefillConfig) {}

  async quote(_order: GiftCardOrder): Promise<Money> {
    void this.cfg;
    throw new Error(NOT_CONFIGURED);
  }

  async purchase(
    _order: GiftCardOrder,
    _dryRun: boolean,
  ): Promise<PurchaseReceipt> {
    throw new Error(NOT_CONFIGURED);
  }
}
