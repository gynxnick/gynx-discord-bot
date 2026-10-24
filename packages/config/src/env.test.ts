import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv, workerEnvSchema } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DISCORD_GUILD_ID: '123456789012345678',
  ENCRYPTION_KEY: 'a'.repeat(64),
  DISCORD_BOT_TOKEN: 'x'.repeat(70),
};

describe('loadEnv', () => {
  it('applies documented defaults', () => {
    const env = loadEnv(workerEnvSchema, base);
    expect(env.STATUS_FAILURE_THRESHOLD).toBe(3);
    expect(env.WEEKLY_REPORT_DAY).toBe('MONDAY');
    expect(env.WEEKLY_REPORT_ENABLED).toBe(true);
  });

  it('lists every problem without echoing values', () => {
    try {
      loadEnv(workerEnvSchema, { ...base, ENCRYPTION_KEY: 'short-secret-value', DATABASE_URL: 'mysql://x' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as Error).message;
      expect(msg).toContain('ENCRYPTION_KEY');
      expect(msg).toContain('DATABASE_URL');
      expect(msg).not.toContain('short-secret-value');
    }
  });

  it('requires https dashboard URL in production', () => {
    expect(() => loadEnv(workerEnvSchema, { ...base, NODE_ENV: 'production', DASHBOARD_URL: 'http://dash' })).toThrow(/https/);
  });
});
