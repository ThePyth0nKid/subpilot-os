import { config } from "dotenv";
// Load env quietly — ANY stdout noise corrupts the MCP JSON-RPC stream.
config({ path: ".env.local", quiet: true });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  OPTIMIZABLE_SERVICES,
  type ServiceSlug,
} from "@/lib/domain/subscription";
import { ingest } from "@/lib/agents/ingest";
import { defaultProfiles } from "@/lib/agents/interview";
import { researchMatrix } from "@/lib/agents/geo-research";
import { DEFAULT_COUNTRIES } from "@/lib/agents/geo-research/countries";
import { optimize } from "@/lib/agents/optimizer";
import { buildReport } from "@/lib/agents/report";
import { runActions, type ActOrder } from "@/lib/agents/action";
import { getProviders } from "@/lib/providers";

type Target = Exclude<ServiceSlug, "unknown">;

const asTargets = (xs: readonly string[]): Target[] =>
  xs.filter((s): s is Target =>
    (OPTIMIZABLE_SERVICES as readonly string[]).includes(s),
  );

const result = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const server = new McpServer({ name: "subpilot-os", version: "0.1.0" });

server.registerTool(
  "scan_statement",
  {
    title: "Scan bank statement",
    description:
      "Detect recurring subscriptions from a bank-statement CSV. Returns Subscription[] with optimizable ones flagged.",
    inputSchema: { csv: z.string().describe("Raw bank-statement CSV text") },
  },
  async ({ csv }) => {
    const { llm } = getProviders();
    return result(await ingest(csv, { llm }));
  },
);

server.registerTool(
  "research_prices",
  {
    title: "Research regional prices",
    description:
      "Fan out Daytona sandboxes to price services across countries (real in-country egress when Bright Data is configured). Returns GeoPriceResult[].",
    inputSchema: {
      services: z
        .array(z.string())
        .optional()
        .describe("e.g. ['netflix','spotify']; default = all optimizable"),
      countries: z
        .array(z.string())
        .optional()
        .describe("ISO-2 codes; default = [IN,TR,US,DE]"),
    },
  },
  async ({ services, countries }) => {
    const { search, llm, proxy } = getProviders();
    const svc = asTargets(
      services?.length ? services : [...OPTIMIZABLE_SERVICES],
    );
    const ctr = countries?.length ? countries : [...DEFAULT_COUNTRIES];
    return result(
      await researchMatrix(svc, ctr, { search, llm, proxy, concurrency: 5 }),
    );
  },
);

server.registerTool(
  "optimize",
  {
    title: "Optimize subscriptions",
    description:
      "Full pipeline: detect → geo-research → optimize. Returns { report, optimization } with €/mo savings.",
    inputSchema: { csv: z.string().describe("Raw bank-statement CSV text") },
  },
  async ({ csv }) => {
    const { llm, search, proxy } = getProviders();
    const subs = await ingest(csv, { llm });
    const profiles = defaultProfiles(subs);
    const optimizable = subs.filter((s) => s.optimizable);
    const svc = asTargets([...new Set(optimizable.map((s) => s.service))]);
    const geo = await researchMatrix(svc, [...DEFAULT_COUNTRIES], {
      search,
      llm,
      proxy,
      concurrency: 5,
    });
    const optimization = optimize(optimizable, geo, { profiles });
    const report = buildReport(optimization);
    return result({ report, optimization });
  },
);

server.registerTool(
  "execute_switch",
  {
    title: "Execute switches (dry-run default)",
    description:
      "Provision accepted switches, each inside an isolated Daytona action sandbox. Returns ActionResult[] with audit trails.",
    inputSchema: {
      orders: z.array(
        z.object({
          subscriptionId: z.string(),
          service: z.string(),
          toCountry: z.string(),
          fromCountry: z.string().optional(),
          amountMinor: z.number().int(),
          currency: z.string(),
        }),
      ),
      dryRun: z.boolean().optional().describe("Defaults to true"),
    },
  },
  async ({ orders, dryRun }) => {
    return result(
      await runActions(orders as ActOrder[], { dryRun: dryRun ?? true }),
    );
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Connected. Do NOT write to stdout — the JSON-RPC stream owns it.
}

main().catch((err) => {
  console.error("subpilot-mcp failed:", err);
  process.exit(1);
});
