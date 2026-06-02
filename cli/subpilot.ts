#!/usr/bin/env -S npx tsx
import "@/scripts/_setup";
import { readFileSync } from "node:fs";
import type { AgentEvent } from "@/lib/domain/events";
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

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  gold: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function printEvent(e: AgentEvent): void {
  const t = e.at.slice(11, 19);
  const country = e.country ? `·${e.country}` : "";
  const color =
    e.phase === "error"
      ? C.red
      : e.agent === "geo-research" || e.agent === "action"
        ? C.cyan
        : C.green;
  console.log(
    `${C.dim}${t}${C.reset} ${color}[${e.agent}${country}]${C.reset} ${e.message}`,
  );
}

function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

async function pipeline(csv: string, execute: boolean): Promise<void> {
  const { llm, search, proxy, modes } = getProviders();
  console.log(
    `${C.dim}providers: search=${modes.search} proxy=${modes.proxy} payment=${modes.payment}${C.reset}\n`,
  );
  const onEvent = printEvent;

  const subs = await ingest(csv, { llm, onEvent });
  const profiles = defaultProfiles(subs, { onEvent });
  const optimizable = subs.filter((s) => s.optimizable);
  const services = [...new Set(optimizable.map((s) => s.service))].filter(
    (s): s is Target =>
      (OPTIMIZABLE_SERVICES as readonly ServiceSlug[]).includes(s),
  );
  const geo = await researchMatrix(services, DEFAULT_COUNTRIES, {
    search,
    llm,
    proxy,
    onEvent,
    concurrency: 5,
  });
  const optimization = optimize(optimizable, geo, { profiles, onEvent });
  const report = buildReport(optimization, { onEvent });

  console.log(
    `\n${C.bold}${C.gold}${eur(report.totalMonthlySavingsEUR)}/mo${C.reset}` +
      ` — €${report.totalAnnualSavingsEUR.toFixed(0)}/yr across ${report.switchCount} switches`,
  );
  for (const line of report.lines) console.log(`  ${C.green}•${C.reset} ${line}`);

  if (execute) {
    const subById = new Map(subs.map((s) => [s.id, s]));
    const orders: ActOrder[] = optimization.recommendations
      .filter((r) => r.viable && r.chosen)
      .map((r) => ({
        subscriptionId: r.subscriptionId,
        service: r.service,
        toCountry: r.chosen!.country,
        fromCountry: subById.get(r.subscriptionId)?.detectedCountry,
        amountMinor: r.chosen!.price.amountMinor,
        currency: r.chosen!.price.currency,
      }));
    console.log(`\n${C.bold}Executing ${orders.length} switches (dry run)…${C.reset}`);
    const results = await runActions(orders, { dryRun: true, onEvent });
    for (const a of results) {
      console.log(`  ${C.gold}${a.giftCardSku}${C.reset} · ${a.receiptRef} · ${a.status}`);
    }
  }
}

async function scan(csv: string): Promise<void> {
  const { llm } = getProviders();
  const subs = await ingest(csv, { llm, onEvent: printEvent });
  console.log(`\n${C.bold}Detected ${subs.length} subscriptions:${C.reset}`);
  for (const s of subs) {
    const mark = s.optimizable ? `${C.gold}★${C.reset}` : " ";
    console.log(
      `  ${mark} ${s.merchantNormalized.padEnd(22)} ${s.service.padEnd(16)} ${eur(s.currentMonthly.monthlyEUR)}/mo`,
    );
  }
}

function usage(): never {
  console.log(
    "Usage: subpilot <scan|run|execute> <statement.csv>\n" +
      "  scan     detect subscriptions only\n" +
      "  run      full pipeline (ingest → geo-research → optimize → report)\n" +
      "  execute  run + dry-run the switches in isolated sandboxes",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const [cmd, file] = process.argv.slice(2);
  if (!cmd || !file) usage();
  const csv = readFileSync(file, "utf8");
  if (cmd === "scan") await scan(csv);
  else if (cmd === "run") await pipeline(csv, false);
  else if (cmd === "execute") await pipeline(csv, true);
  else usage();
}

main().catch((e) => {
  console.error(`${C.red}subpilot failed:${C.reset}`, e);
  process.exit(1);
});
