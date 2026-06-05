import { z } from "zod";

export const AGENT_NAMES = [
  "orchestrator",
  "ingest",
  "insights",
  "interview",
  "geo-research",
  "constraint",
  "optimizer",
  "action",
  "report",
  "login-read",
  "switch",
] as const;

export const AgentNameSchema = z.enum(AGENT_NAMES);
export type AgentName = z.infer<typeof AgentNameSchema>;

export const EventPhaseSchema = z.enum([
  "started",
  "progress",
  "completed",
  "error",
]);
export type EventPhase = z.infer<typeof EventPhaseSchema>;

/** Envelope streamed over SSE so the UI can light up sandboxes live. */
export const AgentEventSchema = z
  .object({
    runId: z.string(),
    at: z.string(), // ISO
    agent: AgentNameSchema,
    sandboxId: z.string().optional(), // geo/action: which sandbox
    country: z.string().optional(), // for the per-country visualization
    phase: EventPhaseSchema,
    message: z.string(),
    payload: z.unknown().optional(),
  })
  .readonly();
export type AgentEvent = z.infer<typeof AgentEventSchema>;
