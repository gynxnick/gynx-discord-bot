import { Client, Events, GatewayIntentBits, Options, Partials } from 'discord.js';
import { Redis } from 'ioredis';
import { botEnvSchema, createLogger, loadEnv } from '@gynx/config';
import { disconnectDb, ensureGuild, getDb } from '@gynx/database';
import {
  RedisRateLimiter,
  createRestDiscordPort,
  defaultRateLimiter,
  startHealthServer,
  type ServiceDeps,
  withGuildText,
} from '@gynx/services';
import { InteractionRouter } from './framework/router';
import type { BotRuntime } from './framework/types';
import { modules } from './modules';

const log = createLogger('bot');

async function main(): Promise<void> {
  const env = loadEnv(botEnvSchema);
  const db = getDb();
  await db.$connect();

  const redis = env.REDIS_URL
    ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false })
    : null;
  redis?.on('error', (err) =>
    log.warn({ err: err.message }, 'redis error (rate limiting falls back to allow)'),
  );

  const deps: ServiceDeps = {
    db,
    log,
    now: () => new Date(),
    rateLimiter: redis ? new RedisRateLimiter(redis) : defaultRateLimiter(),
    discord: createRestDiscordPort(env.DISCORD_BOT_TOKEN),
    encryptionKey: env.ENCRYPTION_KEY,
    dashboardUrl: env.DASHBOARD_URL,
  };

  // Minimum intents for the enabled features. GuildMembers + MessageContent are
  // privileged and must be enabled in the Developer Portal (onboarding, automod).
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.GuildMember],
    allowedMentions: { parse: [] },
    makeCache: Options.cacheWithLimits({ MessageManager: 200, PresenceManager: 0, ReactionManager: 0 }),
  });

  const rt: BotRuntime = { client, env, deps, log };
  const router = new InteractionRouter(rt, modules);

  client.on(Events.InteractionCreate, (i) => void router.handle(i));
  for (const m of modules) {
    for (const l of m.events ?? []) {
      // Typed per-listener via on(); the emitter here is used generically.
      (client as unknown as NodeJS.EventEmitter).on(l.event, (...args: unknown[]) => {
        // Only the configured guild; listener failures never crash the process.
        withGuildText(db, env.DISCORD_GUILD_ID, () => l.run(rt, ...args)).catch((err: unknown) =>
          log.error({ err, module: m.name, event: l.event }, 'event handler failed'),
        );
      });
    }
  }

  client.once(Events.ClientReady, async (c) => {
    log.info(
      { user: c.user.tag, modules: modules.map((m) => m.name), commands: router.commandList.length },
      'bot ready',
    );
    const guild = c.guilds.cache.get(env.DISCORD_GUILD_ID);
    if (!guild) log.warn({ guildId: env.DISCORD_GUILD_ID }, 'bot is not in the configured guild');
    else await ensureGuild(db, guild.id, guild.name);
  });
  client.on(Events.Error, (err) => log.error({ err }, 'discord client error'));
  client.on(Events.ShardDisconnect, () => log.warn('gateway disconnected'));
  client.rest.on('rateLimited', (info) =>
    log.warn({ route: info.route, retryAfter: info.retryAfter }, 'discord rate limited'),
  );

  const health = startHealthServer(
    env.BOT_HEALTH_PORT,
    {
      database: async () => (await db.$queryRaw`SELECT 1`, true),
      gateway: async () => client.isReady() && client.ws.ping >= 0,
    },
    log,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    health.close();
    await client.destroy();
    await redis?.quit().catch(() => undefined);
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));

  await client.login(env.DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.message : err }, 'bot failed to start');
  process.exit(1);
});
