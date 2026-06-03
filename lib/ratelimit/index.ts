import "server-only";
import { NextResponse } from "next/server";
import type { SessionUser } from "@/lib/auth";
import {
  createLimiter,
  type RateLimitResult,
  type RateLimitRule,
} from "./core";

export type { RateLimitResult, RateLimitRule, RateLimiter } from "./core";
export { createLimiter } from "./core";

/**
 * HTTP-facing rate limiting for the expensive / abuse-prone POST routes.
 *
 * Each `POST /api/run` fans out Daytona sandboxes + LLM + Tavily calls, so an
 * unauthenticated burst is costly — limiting is **on by default** (correct for
 * a public repo) and keyed per identity (signed-in user id, else client IP).
 * Single-instance, in-memory; swap a distributed backend behind `RateLimiter`
 * when scaling horizontally.
 */

const MINUTE = 60_000;
const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** The limited routes; each gets its own bucket per caller. */
export type RateLimitScope = "run" | "act" | "stripe";

const limiter = createLimiter();

function isTruthy(raw: string | undefined): boolean {
  return TRUTHY.has((raw ?? "").trim().toLowerCase());
}

/** Positive integer from env, or `fallback` when unset/invalid. */
function envLimit(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ruleFor(scope: RateLimitScope): RateLimitRule {
  switch (scope) {
    case "run":
      return { limit: envLimit("RATE_LIMIT_RUN_PER_MINUTE", 5), windowMs: MINUTE };
    case "act":
      return { limit: envLimit("RATE_LIMIT_ACT_PER_MINUTE", 5), windowMs: MINUTE };
    case "stripe":
      return {
        limit: envLimit("RATE_LIMIT_STRIPE_PER_MINUTE", 10),
        windowMs: MINUTE,
      };
  }
}

/** Rate limiting is on unless `RATE_LIMIT_DISABLED` is truthy (e.g. load tests). */
export function hasRateLimit(): boolean {
  return !isTruthy(process.env.RATE_LIMIT_DISABLED);
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Stable per-caller identity: the user id when signed in, else the client IP. */
export function clientKey(req: Request, user: SessionUser | null): string {
  return user ? `u:${user.id}` : `ip:${clientIp(req)}`;
}

function tooManyRequests(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "Too many requests — please slow down and retry shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    },
  );
}

/**
 * Enforce the per-scope limit for this caller. Returns a ready-to-return `429`
 * response when over the cap, or `null` when the request may proceed (also
 * `null` when rate limiting is disabled). Call it early, after the auth gate.
 */
export function enforceRateLimit(
  req: Request,
  scope: RateLimitScope,
  user: SessionUser | null,
): NextResponse | null {
  if (!hasRateLimit()) return null;
  const result = limiter.check(`${scope}:${clientKey(req, user)}`, ruleFor(scope));
  return result.ok ? null : tooManyRequests(result);
}
