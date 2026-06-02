import { z } from "zod";
import { MoneySchema, NormalizedPriceSchema } from "./money";
import { ServiceSlugSchema } from "./subscription";

/** Output of one GeoResearch agent (1 per service × country). */
export const GeoPriceResultSchema = z
  .object({
    service: ServiceSlugSchema,
    country: z.string(), // ISO-2 the price was measured for
    planName: z.string(),
    price: MoneySchema, // local currency
    normalized: NormalizedPriceSchema, // EUR/month
    acceptedPaymentMethods: z.array(z.string()).readonly(),
    contentNotes: z.string(),
    uiLanguages: z.array(z.string()).readonly(),
    sourceUrl: z.string(),
    capturedAt: z.string(), // ISO
    proxyCountry: z.string(), // proxy region actually used
    screenshotPath: z.string().optional(),
    confidence: z.number().min(0).max(1),
  })
  .readonly();
export type GeoPriceResult = z.infer<typeof GeoPriceResultSchema>;
