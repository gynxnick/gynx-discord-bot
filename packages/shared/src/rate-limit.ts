/**
 * Rate limiting abstraction. The in-memory implementation is used by default
 * (single process); a Redis-backed implementation with the same interface is
 * provided in @gynx/services for multi-instance deployments.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/** Sliding-window log limiter. Bounded memory: keys are pruned when their window empties. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = this.now();
    const windowMs = windowSeconds * 1000;
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      const retry = Math.ceil((windowMs - (now - arr[0]!)) / 1000);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retry) };
    }
    arr.push(now);
    this.hits.set(key, arr);
    this.sweep(now, windowMs);
    return { allowed: true, remaining: limit - arr.length, retryAfterSeconds: 0 };
  }

  private sweep(now: number, windowMs: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, v] of this.hits) {
      if (v.length === 0 || now - v[v.length - 1]! > windowMs) this.hits.delete(k);
    }
  }
}
