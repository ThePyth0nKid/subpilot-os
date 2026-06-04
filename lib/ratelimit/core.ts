/**
 * Pure, dependency-free fixed-window rate limiter for a single instance.
 *
 * Encapsulates a mutable `Map` (a cache by nature); every value returned to a
 * caller is a fresh immutable object. The `RateLimiter` shape is the seam: a
 * distributed backend (e.g. Upstash Redis) can implement it later for
 * horizontal scaling with zero call-site changes.
 *
 * No `next` / `server-only` imports here on purpose — this module stays
 * trivially unit-testable from a plain `tsx` smoke.
 */

/** A fixed-window rate-limit rule: at most `limit` requests per `windowMs`. */
export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

/** Outcome of a single check. Always a new object (never mutated). */
export interface RateLimitResult {
  readonly ok: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number; // epoch ms when the current window resets
  readonly retryAfterSec: number; // 0 when allowed
}

/** The seam an in-memory or distributed limiter both satisfy. */
export interface RateLimiter {
  check(key: string, rule: RateLimitRule): RateLimitResult;
}

interface Window {
  readonly count: number;
  readonly resetAt: number;
}

/** Sweep expired windows past this many tracked keys to bound memory. */
const MAX_TRACKED_KEYS = 50_000;

/**
 * Create an isolated in-memory limiter (its own backing store). Each instance
 * keeps state in process memory, so it protects a single instance; behind a
 * load balancer the cap is per-instance (document this where it matters).
 */
export function createLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, Window>();

  function sweep(at: number): void {
    for (const [key, win] of windows) {
      if (at >= win.resetAt) windows.delete(key);
    }
  }

  return {
    check(key, rule) {
      const at = now();
      if (windows.size > MAX_TRACKED_KEYS) sweep(at);

      const existing = windows.get(key);
      if (!existing || at >= existing.resetAt) {
        const resetAt = at + rule.windowMs;
        windows.set(key, { count: 1, resetAt });
        return {
          ok: true,
          limit: rule.limit,
          remaining: Math.max(0, rule.limit - 1),
          resetAt,
          retryAfterSec: 0,
        };
      }

      const count = existing.count + 1;
      windows.set(key, { count, resetAt: existing.resetAt });
      const ok = count <= rule.limit;
      return {
        ok,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - count),
        resetAt: existing.resetAt,
        retryAfterSec: ok
          ? 0
          : Math.max(1, Math.ceil((existing.resetAt - at) / 1000)),
      };
    },
  };
}
