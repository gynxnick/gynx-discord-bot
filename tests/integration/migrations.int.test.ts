import { afterAll, describe, expect, it } from 'vitest';
import { nextSequence } from '@gynx/database';
import { freshGuild, testDb } from './helpers';

describe('database migrations', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('builds the full schema from an empty database', async () => {
    const rows = await testDb().$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM information_schema.tables WHERE table_schema = 'public'`;
    // 60+ application tables plus _prisma_migrations
    expect(Number(rows[0]!.count)).toBeGreaterThan(55);
  });

  it('records the init migration as applied', async () => {
    const rows = await testDb().$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM _prisma_migrations`;
    expect(rows.some((r) => r.migration_name.endsWith('_init') && r.finished_at)).toBe(true);
  });

  it('creates default guild configuration idempotently', async () => {
    const guildId = await freshGuild();
    const cfg = await testDb().guildConfig.findUniqueOrThrow({ where: { guildId } });
    expect(cfg.timezone).toBe('UTC');
    expect(cfg.enabledModules).toContain('status');
    expect(cfg.enabledModules).not.toContain('tickets');
  });

  it('issues gap-free sequences under concurrency', async () => {
    const guildId = await freshGuild();
    const values = await Promise.all(Array.from({ length: 20 }, () => nextSequence(testDb(), guildId, 'incident')));
    expect(new Set(values).size).toBe(20);
    expect(Math.max(...values)).toBe(20);
  });
});
