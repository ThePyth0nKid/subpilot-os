import type { PreferenceProfile } from "@/lib/domain/preference";
import type { Subscription } from "@/lib/domain/subscription";
import { emitter, type OnEvent } from "@/lib/agents/emit";

export interface InterviewArgs {
  readonly runId?: string;
  readonly onEvent?: OnEvent;
}

/** Sensible demo defaults — a real run would ask these via the Interview UI. */
function defaultProfile(sub: Subscription): PreferenceProfile {
  return {
    subscriptionId: sub.id,
    usage: "weekly",
    householdSize: 2,
    needs4K: false,
    englishOnlyOk: true,
    localContentImportant: false,
    keep: "nice_to_have",
    maxRisk: "medium",
  };
}

/**
 * INTERVIEW AGENT (auto-defaulted for the demo). Produces one
 * PreferenceProfile per subscription so the Constraint agent has the user
 * context it needs to judge viability.
 */
export function defaultProfiles(
  subs: readonly Subscription[],
  { runId = "local", onEvent }: InterviewArgs = {},
): ReadonlyMap<string, PreferenceProfile> {
  const emit = emitter("interview", runId, onEvent);
  emit("started", "Applying preference defaults (demo auto-interview)…");
  // Preferences only make sense for genuine subscriptions — P2P transfers and
  // retail spend (kind !== "subscription") have nothing to interview about.
  const map = new Map<string, PreferenceProfile>();
  for (const s of subs.filter((s) => s.kind === "subscription")) {
    map.set(s.id, defaultProfile(s));
  }
  emit(
    "completed",
    `Captured preferences for ${map.size} subscriptions — English-OK, medium risk tolerance`,
  );
  return map;
}
