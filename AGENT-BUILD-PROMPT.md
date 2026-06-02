# SubPilot OS — Start-Agent-Prompt (autonomous build)

You are an autonomous coding agent building **SubPilot OS** in this repo. Work through the
Work Packages (WP) below **one at a time, in order**. After each WP: make it compile, run its
test step, and only then move on. Keep commits small (one per WP). When the Acceptance Test
passes, stop and report.

## Mission

An agentic OS: upload a bank-statement CSV → detect subscriptions → short interview →
**fan out real Daytona sandboxes (one per subscription × country)** that research real regional
prices → optimizer picks the cheapest *viable* country with a risk score → UI shows a live agent
feed + savings plan → "Execute" runs a (dry-run) action. This is the demo core for a 1-hour build.

## Hard constraints

- **Time budget: ~1 hour.** Favor a working vertical slice over completeness.
- **Real now:** Daytona, Anthropic (Claude), Tavily — keys are in `.env.local`.
- **Mock now (stretch later):** Bright Data proxy, Bitrefill payment. Mocks must satisfy the
  same provider interface so they swap out with zero call-site changes.
- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) FIRST — it defines all data contracts. Do not invent different shapes.
- Conventions: TypeScript strict, **immutable data** (`readonly`, no mutation), small focused files
  (<300 lines), Zod validation at every boundary, comprehensive error handling (never swallow).
- Model routing: Haiku for extraction/normalization, Sonnet for interview/optimizer/orchestration.
  Use Anthropic prompt caching on system prompts + tool defs.

## Work Packages

### WP0 — Scaffold
- `create-next-app` (TypeScript, App Router, Tailwind, ESLint) in repo root. pnpm.
- Load env via a typed `lib/env.ts` (Zod-validate required keys, friendly error if missing).
- Add `GET /api/health` returning `{ ok: true }`.
- **Test:** `pnpm dev`, then `curl localhost:3000/api/health` → `{"ok":true}`.

### WP1 — Domain + schemas
- `lib/domain/*.ts`: the types from ARCHITECTURE.md (Money, Subscription, PreferenceProfile,
  GeoPriceResult, RiskAssessment, Recommendation, OptimizationResult, ActionResult, AgentEvent).
- Matching Zod schemas. A small `lib/domain/fx.ts` with a static EUR FX table.
- **Test:** `pnpm typecheck` (add the script) passes.

### WP2 — Providers (real + mock)
- `lib/providers/llm` (Anthropic wrapper, caching, model routing),
  `lib/providers/search` (Tavily real),
  `lib/providers/proxy` (mock pass-through, real Bright Data stub),
  `lib/providers/payment` (mock receipt, real Bitrefill stub).
- A `lib/providers/index.ts` factory that picks real/mock based on env presence.
- **Test:** a script `pnpm tsx scripts/smoke-search.ts "Spotify price India 2026"` prints a Tavily answer.

### WP3 — Ingest agent
- `lib/agents/ingest`: deterministic CSV parse → cluster recurring tx → Claude **Haiku** normalizes
  merchant + maps to `ServiceSlug` → `Subscription[]`.
- `POST /api/ingest` (multipart or text CSV) → `Subscription[]`.
- **Test:** post `fixtures/sample-bank-statement.csv` → returns Netflix, Spotify, Disney+, YouTube,
  ChatGPT (+ Amazon Prime/iCloud) with monthly EUR.

### WP4 — Daytona sandbox runner
- `lib/daytona/runner.ts` using `@daytonaio/sdk`: create sandbox (snapshot if available),
  exec a command / run JS, collect stdout, teardown. Concurrency-limited `fanOut(items, fn)` helper
  that emits `AgentEvent`s (started/progress/completed per sandbox).
- **Test:** `pnpm tsx scripts/smoke-daytona.ts` spins up 1 sandbox, runs `node -e "console.log('hi')"`, tears down.

### WP5 — Geo-research agent (in sandbox, fan-out)
- `lib/agents/geo-research`: for `{service, country}` → use **Tavily** (country-aware query) to get the
  regional price, Claude **Haiku** to extract → `GeoPriceResult`. Run each via the Daytona fan-out.
- `POST /api/research` `{ service, countries[] }` → `GeoPriceResult[]`.
- **Test:** research `netflix` over `[IN,TR,US,DE]` → 4 results, India clearly cheapest.

### WP6 — Constraint + Optimizer
- `lib/agents/constraint`: filter options by preference + feasibility + risk; attach `RiskAssessment`.
- `lib/agents/optimizer`: cheapest viable per sub, savings, tradeoffs → `OptimizationResult`.
- **Test:** `pnpm tsx scripts/smoke-optimize.ts` on the sample → prints total €/month saved.

### WP7 — Orchestrator + event stream
- `lib/orchestrator`: the state machine (ingest→…→report) with in-memory run store.
- `GET /api/run/:id/events` Server-Sent Events streaming `AgentEvent`s.
- `POST /api/run` starts a run from an uploaded CSV (interview answers optional/defaulted for demo).
- **Test:** start a run on the sample → SSE emits ingest + per-country research + optimize + report events.

### WP8 — UI
- One page: upload CSV → **live agent feed** (cards per sandbox/country lighting up via SSE) →
  **savings plan** (per sub: current vs best country, €/mo saved, risk badge, tradeoffs) →
  **Execute** button → dry-run `ActionResult` + receipt + total saved.
- Clean, demo-friendly (Tailwind). Show the parallel sandboxes prominently.
- **Test:** manual — upload sample, watch the flow to a savings number + execute.

### WP9 — Polish
- README run steps verified, sample wired as a one-click "Try demo" button, basic error toasts.

## Acceptance Test (stop when green)

`pnpm dev` → open app → click "Try demo" (or upload `fixtures/sample-bank-statement.csv`) →
watch real Daytona sandboxes fan out across countries → see a total **€/month saved** with per-sub
recommendations and risk badges → click **Execute** → get a dry-run receipt + audit trail.

## Report back

When done (or if blocked), report: which WPs are green, the demo savings number on the sample,
any failing test + error, and exactly what you need (e.g. a Bright Data or Bitrefill key to go from
mock to real).
