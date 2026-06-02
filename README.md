# 🚀 SubPilot OS

> **Agentic work OS** — upload a bank statement, get an *executed* subscription savings plan.
> Built for the Antler hackathon: "Build an agentic work OS" (real multi-agent orchestration, not a chatbot).

## What it does

Messy work in → finished work out:

1. **CSV bank statement in** → subscriptions auto-detected
2. **Quick interview** — e.g. "How often do you use Netflix?" / "English-only content OK?"
3. **Fan-out** — one **Daytona sandbox per subscription × country**, each routed through a real country IP → real regional prices (Netflix India ~€2 vs Germany ~€20)
4. **Optimizer** picks the cheapest *viable* country + an honest **risk score** & trade-offs
5. **One click** — agents pay via gift card (Bitrefill), create the account, cancel the old plan
6. **Report** — €X/month saved, with a full audit trail

## Why it wins

The brief demands **meaningful multi-agent orchestration**. We spin up one Daytona sandbox per agent — on stage you watch ~12 sandboxes across 5 countries check live prices *at the same time*. That parallel fan-out **is** the differentiator.

## Agent crew

`Ingest` · `Interview` · `Geo-Research` (×many, in sandboxes) · `Constraint` · `Optimizer` · `Action` (in sandboxes) · `Report` — coordinated by one **Orchestrator** (the OS kernel).

Full data contracts & state machine: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

Next.js + TypeScript · Claude (Sonnet + Haiku) · Daytona Sandboxes · Bright Data Proxy · Tavily Search · Bitrefill Payment

## Status (hackathon, 1h build target)

**Demo core (must run):** CSV → detect → interview → **real Daytona multi-agent geo-research (prices via Tavily)** → optimizer w/ risk score → savings UI → simulated execute.

**Stretch:** real Bright Data routing · 1 real Bitrefill purchase · PDF input.

## Quickstart

```bash
pnpm install
cp .env.example .env.local   # fill in keys (Daytona, Anthropic, Tavily already used locally)
pnpm dev                     # http://localhost:3000
```

Drop [`fixtures/sample-bank-statement.csv`](fixtures/sample-bank-statement.csv) into the upload box.

## Build it (autonomous agent)

Feed [`AGENT-BUILD-PROMPT.md`](AGENT-BUILD-PROMPT.md) to your coding agent (Cursor / Claude). It works through ordered, testable work-packages until `pnpm dev` shows a working demo.

## Team split (need ≥3 for the prize)

- **A — Frontend/Flow:** upload, live agent feed, savings UI, interview
- **B — Daytona/Geo:** sandbox fan-out, proxy routing, price scraping
- **C — Brain/Action:** detection, optimizer, Bitrefill, report

## Security

Secrets live only in `.env.local` (gitignored). Geo-arbitrage carries ToS risk — the product surfaces a **risk score** and prefers the legitimate in-region **gift-card** path, with an explicit consent gate before any real action.
