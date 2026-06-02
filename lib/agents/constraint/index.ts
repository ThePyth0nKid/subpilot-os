import type { GeoPriceResult } from "@/lib/domain/geo-price";
import type { PreferenceProfile, RiskTolerance } from "@/lib/domain/preference";
import { RiskAssessmentSchema, type RiskAssessment } from "@/lib/domain/risk";
import type { Subscription } from "@/lib/domain/subscription";

const RISK_RANK: Readonly<Record<RiskTolerance, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
});

/** Markets where geo-arbitrage carries a higher ToS / region-lock risk. */
const HIGH_ARBITRAGE = new Set(["IN", "TR", "AR"]);

export interface OptionAssessment {
  readonly geo: GeoPriceResult;
  readonly viable: boolean;
  readonly risk: RiskAssessment;
  readonly tradeoffs: readonly string[];
}

function assessRisk(
  sub: Readonly<Subscription>,
  geo: Readonly<GeoPriceResult>,
): RiskAssessment {
  const crossRegion = geo.country !== sub.detectedCountry;
  if (!crossRegion) {
    return RiskAssessmentSchema.parse({
      level: "low",
      tosViolationLikelihood: 0.03,
      accountBanRisk: 0.01,
      reasons: ["Home-region plan — no geo-arbitrage involved"],
      mitigations: [],
    });
  }
  const high = HIGH_ARBITRAGE.has(geo.country);
  return RiskAssessmentSchema.parse({
    level: high ? "medium" : "low",
    tosViolationLikelihood: high ? 0.35 : 0.15,
    accountBanRisk: high ? 0.08 : 0.03,
    reasons: [
      `Account region set to ${geo.country} while billing from ${sub.detectedCountry}`,
      high
        ? "Provider may region-lock the catalogue or request local payment"
        : "Low-friction region switch with broad payment acceptance",
    ],
    mitigations: [
      "Pay via Bitrefill regional gift card (no card-country mismatch)",
      "Keep usage within normal patterns; avoid rapid region hopping",
    ],
  });
}

function buildTradeoffs(
  sub: Readonly<Subscription>,
  geo: Readonly<GeoPriceResult>,
): readonly string[] {
  if (geo.country === sub.detectedCountry) return ["Keep current region"];
  const out: string[] = [`Billed via ${geo.country} gift card (Bitrefill)`];
  if (geo.contentNotes) out.push(geo.contentNotes);
  if (geo.uiLanguages.length && !geo.uiLanguages.includes("English")) {
    out.push(`UI languages: ${geo.uiLanguages.join(", ")}`);
  }
  return out;
}

/**
 * CONSTRAINT AGENT — judges one geo option against the user's preferences and
 * feasibility, attaching a deterministic RiskAssessment. Pure + immutable.
 */
export function assessOption(
  sub: Readonly<Subscription>,
  geo: Readonly<GeoPriceResult>,
  profile: Readonly<PreferenceProfile>,
): OptionAssessment {
  const risk = assessRisk(sub, geo);
  const riskOk = RISK_RANK[risk.level] <= RISK_RANK[profile.maxRisk];
  const languageOk =
    profile.englishOnlyOk ||
    geo.uiLanguages.length === 0 ||
    geo.uiLanguages.includes("English");
  const paymentOk = geo.acceptedPaymentMethods.length > 0;
  return {
    geo,
    viable: riskOk && languageOk && paymentOk,
    risk,
    tradeoffs: buildTradeoffs(sub, geo),
  };
}
