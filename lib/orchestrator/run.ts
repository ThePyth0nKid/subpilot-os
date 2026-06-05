import type { AgentEvent, AgentName, EventPhase } from "@/lib/domain/events";
import {
  OPTIMIZABLE_SERVICES,
  type OptimizableService,
  type ServiceSlug,
  type Subscription,
} from "@/lib/domain/subscription";
import { ingest } from "@/lib/agents/ingest";
import { defaultProfiles } from "@/lib/agents/interview";
import { researchMatrix } from "@/lib/agents/geo-research";
import { DEFAULT_COUNTRIES } from "@/lib/agents/geo-research/countries";
import { optimize } from "@/lib/agents/optimizer";
import { buildReport } from "@/lib/agents/report";
import { getProviders } from "@/lib/providers";
import { hasPII } from "@/lib/anonymize";
import { holderNames, loadEnv } from "@/lib/env";
import { persistRun } from "@/lib/db/repo";
import { emit, markTerminal, setStatus } from "./store";
import type { RunSnapshot } from "./types";

/** Holder names from env, never crashing the pipeline if env is incomplete. */
function serverHolderNames(): readonly string[] {
  try {
    return holderNames(loadEnv());
  } catch {
    return [];
  }
}

/** Never surface a raw error string that might echo a CSV/PII fragment. */
function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Run failed";
  return hasPII(raw) ? "Run failed (could not process input)" : raw;
}

type Target = OptimizableService;

/**
 * ORCHESTRATOR — the OS kernel. Drives the 7-agent state machine for one run,
 * forwarding every agent's typed events onto the run's SSE stream.
 */
export async function runPipeline(
  runId: string,
  csv: string,
  userId?: string,
): Promise<void> {
  const onEvent = (event: AgentEvent): void => emit(runId, event);
  const kernel = (phase: EventPhase, message: string, payload?: unknown): void =>
    onEvent({
      runId,
      at: new Date().toISOString(),
      agent: "orchestrator" as AgentName,
      phase,
      message,
      ...(payload === undefined ? {} : { payload }),
    });

  try {
    kernel("started", "Kernel online · booting agent pipeline");

    setStatus(runId, "ingesting");
    const { llm, search, proxy } = getProviders();
    const { subscriptions, findings } = await ingest(csv, {
      llm,
      runId,
      onEvent,
      holderNames: serverHolderNames(),
    });

    setStatus(runId, "interviewing");
    const profiles = defaultProfiles(subscriptions, { runId, onEvent });

    const optimizable = subscriptions.filter(
      (s): s is Subscription => s.optimizable,
    );
    const services = [
      ...new Set(optimizable.map((s) => s.service)),
    ].filter((s): s is Target =>
      (OPTIMIZABLE_SERVICES as readonly ServiceSlug[]).includes(s),
    );

    setStatus(runId, "researching");
    kernel(
      "progress",
      `Fanning out ${services.length * DEFAULT_COUNTRIES.length} sandboxes · ${services.length} services × ${DEFAULT_COUNTRIES.length} countries`,
    );
    const geoResults = await researchMatrix(services, DEFAULT_COUNTRIES, {
      search,
      llm,
      proxy,
      runId,
      onEvent,
      concurrency: 5,
    });

    setStatus(runId, "optimizing");
    const optimization = optimize(optimizable, geoResults, {
      profiles,
      runId,
      onEvent,
    });

    setStatus(runId, "reporting");
    const report = buildReport(optimization, { runId, onEvent });

    const snapshot: RunSnapshot = { subscriptions, findings, optimization, report };
    setStatus(runId, "done");
    await persistRun({ id: runId, userId, snapshot }).catch(() => {
      /* persistence is best-effort; never fail the run on a DB hiccup */
    });
    kernel("completed", report.headline, snapshot);
  } catch (err) {
    setStatus(runId, "error");
    kernel("error", safeErrorMessage(err));
  } finally {
    markTerminal(runId);
  }
}
