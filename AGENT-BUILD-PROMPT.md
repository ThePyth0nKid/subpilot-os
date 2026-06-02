# SubPilot OS — Continuation Prompt (autonomous agent, next PRs)

You are an autonomous coding agent continuing **SubPilot OS**. The initial 1-hour vertical slice
**and** the demo→MVP upgrade are already shipped and live on GitHub. Your job now is to pick up the
backlog below and ship it **as small, reviewed pull requests** — one focused PR at a time.

## Current state (already shipped — do not rebuild)

A working agentic OS: upload a bank-statement CSV → detect subscriptions → auto-interview →
**fan out real Daytona sandboxes per service × country** (each runs a real `curl` egress check +
in-country evidence fetch) → constraint + optimizer pick the cheapest *viable* country with a risk
score → live SSE agent feed + savings plan → **Execute** runs each switch inside its **own isolated
Daytona action sandbox** (the payment token only ever enters that ephemeral sandbox) → audited
dry-run receipts. Plus: **WorkOS AuthKit login**, **Postgres/Drizzle** per-user history, **Stripe**
card capture (test mode), a **`subpilot` CLI**, and an **MCP server** (drive it from Cursor/Claude Code).

- Shipped work packages: **WP0–WP15** (scaffold → domain → providers → ingest → Daytona runner →
  geo-research → constraint/optimizer → orchestrator+SSE → UI → real geo sandbox → auth → persistence
  → Stripe → action sandbox → CLI → MCP). A code + security review pass is also merged.
- **Every integration is optional and graceful:** with no keys the app runs in open demo mode
  (mock proxy/payment, no login, in-memory runs). Keys in `.env.local` light each up — see `.env.example`.

## Read first

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data contracts + agent topology + state machine. **Do not invent different shapes.**
- [`docs/STRETCH-SETUP.md`](docs/STRETCH-SETUP.md) — how to wire real Bright Data + Bitrefill.
- `lib/providers/index.ts` (real/mock factory), `lib/orchestrator/run.ts` (the pipeline),
  `lib/agents/*` (the 7 agents), `lib/daytona/*` (sandbox primitives).

## Conventions (non-negotiable)

- TypeScript strict; **immutable data** (`readonly`, return new objects, never mutate).
- Small focused files (<300 lines); **Zod validation at every boundary**; never swallow errors silently.
- Provider interfaces so mock ↔ real swap with **zero call-site changes**.
- Keep **graceful degradation**: any new integration must no-op (not crash) when its env keys are absent.
- Model routing: Haiku for extraction/normalization, Sonnet for reasoning. Anthropic prompt caching on system prompts + tool defs.
- **Never commit secrets.** `.env.local` is gitignored; only `.env.example` (empty placeholders) is tracked. Add any new key to `.env.example` (empty) + `lib/env.ts` (optional) + a `hasX()` helper.

## PR workflow (how to ship each item)

1. **Branch** off `main`: `git checkout -b feat/<short-name>` (or `fix/`, `chore/`). Do **not** commit directly to `main`.
2. Implement the smallest coherent change. Reuse existing utilities (`emit`/`OnEvent`, `getProviders`,
   `withSandbox`/`fanOut`, `LlmClient.extract`, domain Zod schemas, the SSE store).
3. **Verify:** `npm run typecheck` **and** `npm run build` must be green, then run the relevant smoke
   (a `scripts/smoke-*.ts`, `cli/subpilot.ts`, or the MCP handshake). Add/adjust a smoke for new behavior.
4. **Self-review** for correctness + security (you handle auth, payment, sandboxes, DB — be paranoid).
5. Commit (conventional commits, small) and open a PR with `gh pr create` — title + body summarizing
   what/why + a test plan. One feature per PR. Stop and report after each PR; do not batch unrelated work.

## Backlog — next PRs (priority order)

Most of these are the deferred follow-ups from the merged code + security review.

### P1 — Security hardening
1. **Rate limiting** on `POST /api/run`, `POST /api/act`, `POST /api/stripe/setup-intent`
   (Upstash Redis or an in-memory token bucket for single-instance). `/api/run` fans out Daytona +
   LLM + Tavily per call — cap concurrency per user/IP. (Review C2.)
2. **Dependency CVEs:** `protobufjs` (HIGH, via `@daytonaio/sdk` → OTel) and `esbuild` (moderate, dev-only,
   via `drizzle-kit`). `npm audit fix --force` is a breaking SDK change — evaluate carefully, pin, test
   the Daytona path end-to-end before merging. (Review H4/L3.)
3. **Content-Security-Policy** header in `next.config.ts` — must allowlist `js.stripe.com` + `*.stripe.com`
   (Stripe Elements) and WorkOS, or it will break card capture / login. Test both flows. (Review M1.)

### P2 — Correctness / robustness
4. **Per-currency minor units** table (`JPY`=1, `KWD`=1000, default 100) used by `isPlausible` +
   `fallbackPrice` in `lib/agents/geo-research/extract.ts`, so adding 0/3-decimal currencies stays correct. (Review M1-code.)
5. **`pricingUrl` country awareness** — `netflix` + `youtube_premium` in `lib/agents/geo-research/sources.ts`
   ignore the country param (always US-English page). Use country-specific pricing/help URLs. (Review L1.)
6. **Persist `ActionResult`** to Postgres (new `actions` table) so execute history survives, gated by auth+DB.
7. **MCP `execute_switch`** — `z.parse` the orders against the domain shape before `runActions` (drop the `as` cast) for Zod-at-boundary consistency.

### P3 — Product / mock→real
8. **Real Bright Data** end-to-end: with `BRIGHTDATA_*` set, confirm the geo probe shows real in-country
   egress (`Egress confirmed IN ✓ in-country`) — see `docs/STRETCH-SETUP.md`. Add a smoke that asserts country match.
9. **Real Bitrefill** purchase path in `lib/providers/payment/bitrefill.ts` (currently a stub) + wire the
   live action sandbox to it behind the consent toggle. Keep dry-run the default.
10. **CLI `--live`** flag for `subpilot execute` (web UI already has the live toggle; CLI is dry-run only).
11. **Interview UI** — the architecture has a real Interview agent; today it's auto-defaulted. Add the
    in-UI question flow (`Question[]` → `PreferenceProfile[]`) before research.

### P4 — Quality
12. **Tests:** the repo has only build-style smokes. Add unit tests (ingest clustering, optimizer math,
    fx, plausibility clamp), integration tests (API routes), and a Playwright E2E for the happy path.
    Target the project's 80% coverage rule for new/changed code.

## Report back (per PR)

PR link, what changed + why, which checks ran green (typecheck/build/smoke), and anything you need
(e.g. a real Bright Data / Bitrefill / WorkOS / Stripe test key, or a Postgres `DATABASE_URL`).
