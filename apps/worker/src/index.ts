import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { createLogger, loadEnv, workerEnvSchema } from '@gynx/config';
import { disconnectDb, ensureGuild, getDb } from '@gynx/database';
import {
  RedisRateLimiter,
  createRestDiscordPort,
  defaultRateLimiter,
  setup,
  startHealthServer,
} from '@gynx/services';
import { JobRunner } from './framework/runner';
import type { WorkerCtx } from './framework/types';
import { workerModules } from './jobs';

const log = createLogger('worker');

async function main(): Promise<void> {
  const env = loadEnv(workerEnvSchema);
  const db = getDb();
  await db.$connect();
  await ensureGuild(db, env.DISCORD_GUILD_ID);

  const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
  redis?.on('error', (err) => log.warn({ err: err.message }, 'redis error'));

  const w: WorkerCtx = {
    deps: {
      db,
      log,
      now: () => new Date(),
      rateLimiter: redis ? new RedisRateLimiter(redis) : defaultRateLimiter(),
      discord: createRestDiscordPort(env.DISCORD_BOT_TOKEN),
      discordAdmin: setup.createRestDiscordAdminPort(env.DISCORD_BOT_TOKEN),
      encryptionKey: env.ENCRYPTION_KEY,
      dashboardUrl: env.DASHBOARD_URL,
    },
    env,
    log,
    workerId: `${hostname()}:${process.pid}`,
  };

  const runner = new JobRunner(w, workerModules);
  runner.start();
  log.info(
    { jobTypes: runner.jobTypes, periodic: runner.periodicNames, workerId: w.workerId },
    'worker started',
  );

  let lastTickOk = Date.now();
  const health = startHealthServer(
    env.WORKER_HEALTH_PORT,
    {
      database: async () => {
        await db.$queryRaw`SELECT 1`;
        lastTickOk = Date.now();
        return true;
      },
      loop: async () => Date.now() - lastTickOk < 5 * 60_000,
    },
    log,
  );

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down (finishing in-flight jobs)');
    health.close();
    await runner.stop();
    await redis?.quit().catch(() => undefined);
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.message : err }, 'worker failed to start');
  process.exit(1);
});
