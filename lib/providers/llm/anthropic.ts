import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CompleteArgs, ExtractArgs, LlmClient } from "./types";

/**
 * Anthropic-backed LlmClient.
 * - Prompt caching (`cache_control: ephemeral`) on the system prompt + tool def,
 *   which are stable per agent → cheap cache hits across fan-out calls.
 * - Structured extraction via a single forced tool whose input_schema is derived
 *   from a Zod schema, then re-validated with Zod on the way out.
 */
export class AnthropicClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(args: CompleteArgs): Promise<string> {
    const res = await this.client.messages.create({
      model: args.model,
      max_tokens: args.maxTokens ?? 1024,
      system: [
        { type: "text", text: args.system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: args.user }],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  async extract<T>(args: ExtractArgs<T>): Promise<T> {
    const toolName = args.toolName ?? "emit_result";
    const jsonSchema = toAnthropicSchema(args.schema);

    const res = await this.client.messages.create({
      model: args.model,
      max_tokens: args.maxTokens ?? 1024,
      system: [
        { type: "text", text: args.system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: args.user }],
      tools: [
        {
          name: toolName,
          description:
            args.toolDescription ?? "Return the structured result for this task.",
          input_schema: jsonSchema,
          cache_control: { type: "ephemeral" },
        } as Anthropic.Tool,
      ],
      tool_choice: { type: "tool", name: toolName },
    });

    const block = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!block) {
      throw new Error("LLM returned no tool_use block for structured extraction");
    }
    return args.schema.parse(block.input);
  }
}

/** Convert a Zod schema into a JSON Schema Anthropic accepts as `input_schema`. */
function toAnthropicSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
  delete json["$schema"];
  return json as Anthropic.Tool.InputSchema;
}
