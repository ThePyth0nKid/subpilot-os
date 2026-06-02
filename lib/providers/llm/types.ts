import type { z } from "zod";

/** Model routing per ARCHITECTURE.md: Haiku for workers, Sonnet for reasoning. */
export const MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export interface CompleteArgs {
  readonly model: ModelId;
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
}

export interface ExtractArgs<T> {
  readonly model: ModelId;
  readonly system: string;
  readonly user: string;
  /** Zod schema describing the structured result the model must return. */
  readonly schema: z.ZodType<T>;
  readonly toolName?: string;
  readonly toolDescription?: string;
  readonly maxTokens?: number;
}

/** Thin Anthropic wrapper: prompt caching + model routing + structured extraction. */
export interface LlmClient {
  /** Free-text completion. */
  complete(args: CompleteArgs): Promise<string>;
  /** Tool-forced structured output, validated against `schema`. */
  extract<T>(args: ExtractArgs<T>): Promise<T>;
}
