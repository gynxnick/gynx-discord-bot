import 'server-only';
import { Redis } from 'ioredis';
import { createLogger, type Logger } from '@gynx/config';
import { getDb } from '@gynx/database';
import { RedisRateLimiter, createRestDiscordPort, type DiscordPort, type ServiceDeps } from '@gynx/services';
import { MemoryRateLimiter, type RateLimiter } from '@gynx/shared';
import { getEnv } from './env';

type DashboardDeps = ServiceDeps & { discord: DiscordPort };

// Survive Next.js dev hot reloads without leaking connections.
const g = globalThis as typeof globalThis & {
  __gynxDashboardDeps?: DashboardDeps;
  __gynxDashboardLog?: Logger;
};

export function getLogger(): Logger {
  if (!g.__gynxDashboardLog) g.__gynxDashboardLog = createLogger('dashboard');
  return g.__gynxDashboardLog;
}

function createRateLimiter(url: string | undefined, log: Logger): RateLimiter {
  if (!url) return new MemoryRateLimiter();
  const redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  redis.on('error', (err) =>
    log.warn({ err: { message: err.message } }, 'redis error (rate limiting fails open)'),
  );
  return new RedisRateLimiter(redis, 'gynx:rl:dash:');
}

/** Process-wide service dependencies for the dashboard (lazy; requires env at first use). */
export function getDeps(): DashboardDeps {
  if (!g.__gynxDashboardDeps) {
    const env = getEnv();
    const log = getLogger();
    g.__gynxDashboardDeps = {
      db: getDb(),
      log,
      now: () => new Date(),
      rateLimiter: createRateLimiter(env.REDIS_URL, log),
      discord: createRestDiscordPort(env.DISCORD_BOT_TOKEN),
      encryptionKey: env.ENCRYPTION_KEY,
      dashboardUrl: env.DASHBOARD_URL,
      linkSigningSecret: env.SESSION_SECRET,
    };
  }
  return g.__gynxDashboardDeps;
}
