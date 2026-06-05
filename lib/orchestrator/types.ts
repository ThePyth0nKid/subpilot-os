import type { OptimizationResult } from "@/lib/domain/recommendation";
import type { Subscription } from "@/lib/domain/subscription";
import type { Finding } from "@/lib/domain/insight";
import type { RunReport } from "@/lib/agents/report";

/** OS-kernel phases (mirrors the state machine in the architecture). */
export type RunStatus =
  | "idle"
  | "ingesting"
  | "interviewing"
  | "researching"
  | "optimizing"
  | "reporting"
  | "done"
  | "error";

/** Final structured payload delivered on the terminal orchestrator event. */
export interface RunSnapshot {
  readonly subscriptions: readonly Subscription[];
  readonly findings: readonly Finding[];
  readonly optimization: OptimizationResult;
  readonly report: RunReport;
}
