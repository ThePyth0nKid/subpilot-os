import type { AgentEvent, AgentName, EventPhase } from "@/lib/domain/events";

export type OnEvent = (event: AgentEvent) => void;

/**
 * Builds a typed event emitter bound to one agent + run. Agents call
 * `emit(phase, message, extra)`; the orchestrator supplies `onEvent` to forward
 * over SSE. Standalone scripts can omit `onEvent`.
 */
export function emitter(agent: AgentName, runId: string, onEvent?: OnEvent) {
  return (
    phase: EventPhase,
    message: string,
    extra: Partial<Pick<AgentEvent, "sandboxId" | "country" | "payload">> = {},
  ): void => {
    onEvent?.({
      runId,
      at: new Date().toISOString(),
      agent,
      phase,
      message,
      ...extra,
    });
  };
}
