import type { Redis } from 'ioredis';
import type { RateLimiter, RateLimitResult } from '@gynx/shared';

/**
 * Fixed-window Redis rate limiter for multi-instance deployments. Falls back
 * to allowing the request if Redis is unreachable (fail-open is acceptable
 * for rate limiting; authorization never depends on Redis).
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gynx:rl:',
  ) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const k = `${this.prefix}${key}`;
    try {
      const results = await this.redis.multi().incr(k).expire(k, windowSeconds, 'NX').ttl(k).exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
      if (count > limit) return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, ttl) };
      return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
    } catch {
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }
  }
}
