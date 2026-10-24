import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const weekday = z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake ID');

/** Settings shared by every process. */
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith('postgres'), 'must be a PostgreSQL URL'),
  REDIS_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  DISCORD_GUILD_ID: snowflake,
  DEFAULT_TIMEZONE: z.string().default('UTC'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Fa-f0-9]{64}$/, 'must be 32 bytes encoded as 64 hex characters (openssl rand -hex 32)'),
});

export const botEnvSchema = baseSchema.extend({
  DISCORD_BOT_TOKEN: z.string().min(50, 'DISCORD_BOT_TOKEN looks invalid'),
  DISCORD_APPLICATION_ID: snowflake,
  DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
  BOT_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  DIAGNOSTIC_RETENTION_HOURS: z.coerce.number().int().min(1).default(24),
  PORTCHECK_ALLOWED_SUFFIXES: z.string().default(''),
});

export const workerEnvSchema = baseSchema.extend({
  DISCORD_BOT_TOKEN: z.string().min(50, 'DISCORD_BOT_TOKEN looks invalid'),
  DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8082),
  STATUS_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(60),
  STATUS_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  STATUS_RECOVERY_THRESHOLD: z.coerce.number().int().min(1).default(2),
  WEEKLY_REPORT_ENABLED: bool.default('true'),
  WEEKLY_REPORT_DAY: weekday.default('MONDAY'),
  WEEKLY_REPORT_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24h)')
    .default('09:00'),
});

export const dashboardEnvSchema = baseSchema.extend({
  DISCORD_BOT_TOKEN: z.string().min(50, 'DISCORD_BOT_TOKEN looks invalid'),
  DISCORD_OAUTH_CLIENT_ID: snowflake,
  DISCORD_OAUTH_CLIENT_SECRET: z.string().min(16),
  DASHBOARD_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
});

export type BotEnv = z.infer<typeof botEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type DashboardEnv = z.infer<typeof dashboardEnvSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate environment variables. Throws ConfigError listing every
 * problem (never the values) so misconfiguration fails fast and clearly.
 */
export function loadEnv<S extends z.ZodTypeAny>(
  schema: S,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const env = result.data as Record<string, unknown>;
  if (
    env.NODE_ENV === 'production' &&
    typeof env.DASHBOARD_URL === 'string' &&
    !env.DASHBOARD_URL.startsWith('https://')
  ) {
    throw new ConfigError(['DASHBOARD_URL: must use https:// in production']);
  }
  return result.data;
}
