import type { OptimizationResult } from "@/lib/domain/recommendation";
import { emitter, type OnEvent } from "@/lib/agents/emit";

export interface RunReport {
  readonly headline: string;
  readonly totalCurrentMonthlyEUR: number;
  readonly totalOptimizedMonthlyEUR: number;
  readonly totalMonthlySavingsEUR: number;
  readonly totalAnnualSavingsEUR: number;
  readonly switchCount: number;
  readonly lines: readonly string[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ReportArgs {
  readonly runId?: string;
  readonly onEvent?: OnEvent;
}

/**
 * REPORT AGENT — turns the OptimizationResult into a human savings summary.
 * Deterministic for demo robustness (a real build would let Sonnet narrate).
 */
export function buildReport(
  opt: OptimizationResult,
  { runId = "local", onEvent }: ReportArgs = {},
): RunReport {
  const emit = emitter("report", runId, onEvent);
  const switchCount = opt.recommendations.filter((r) => r.viable).length;
  const annual = round2(opt.totalMonthlySavingsEUR * 12);

  const lines = opt.recommendations
    .filter((r) => r.viable && r.chosen)
    .map(
      (r) =>
        `${r.service} → ${r.chosen!.country}: save €${r.monthlySavingsEUR.toFixed(2)}/mo (€${r.annualSavingsEUR.toFixed(2)}/yr)`,
    );

  const report: RunReport = {
    headline:
      switchCount > 0
        ? `Save €${opt.totalMonthlySavingsEUR.toFixed(2)}/mo — €${annual.toFixed(0)}/yr — across ${switchCount} subscriptions`
        : "No safe savings found — you're already optimally priced",
    totalCurrentMonthlyEUR: opt.totalCurrentMonthlyEUR,
    totalOptimizedMonthlyEUR: opt.totalOptimizedMonthlyEUR,
    totalMonthlySavingsEUR: opt.totalMonthlySavingsEUR,
    totalAnnualSavingsEUR: annual,
    switchCount,
    lines,
  };
  emit("completed", report.headline, { payload: report });
  return report;
}
