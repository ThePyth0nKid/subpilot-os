import { createLimiter, type RateLimitRule } from "@/lib/ratelimit/core";

/** Tiny assert that fails the smoke loudly. */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[smoke-ratelimit] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[smoke-ratelimit] ok: ${msg}`);
}

// Injected clock so we can advance time without real sleeps.
let now = 1_000_000;
const limiter = createLimiter(() => now);
const rule: RateLimitRule = { limit: 3, windowMs: 60_000 };
const key = "run:ip:1.2.3.4";

const r1 = limiter.check(key, rule);
assert(r1.ok && r1.remaining === 2, "1st request allowed, remaining=2");
const r2 = limiter.check(key, rule);
assert(r2.ok && r2.remaining === 1, "2nd request allowed, remaining=1");
const r3 = limiter.check(key, rule);
assert(r3.ok && r3.remaining === 0, "3rd request allowed, remaining=0");

const r4 = limiter.check(key, rule);
assert(!r4.ok, "4th request blocked (over limit)");
assert(r4.remaining === 0, "blocked response reports remaining=0");
assert(r4.retryAfterSec >= 1 && r4.retryAfterSec <= 60, "blocked sets a sane Retry-After");

// A different identity has an independent bucket.
const other = limiter.check("run:ip:5.6.7.8", rule);
assert(other.ok && other.remaining === 2, "independent key is unaffected");

// Scopes are isolated by the caller-supplied key prefix.
const scoped = limiter.check("act:ip:1.2.3.4", rule);
assert(scoped.ok, "different scope, same IP is a separate bucket");

// Advance past the window → the bucket resets.
now += 60_001;
const afterReset = limiter.check(key, rule);
assert(afterReset.ok && afterReset.remaining === 2, "window resets after windowMs");

console.log("[smoke-ratelimit] PASS");
