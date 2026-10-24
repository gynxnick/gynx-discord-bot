import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { community, makeCtx, systemActor } from '@gynx/services';
import { freshGuild, silentLog, snowflake, testDb, testDeps } from '../../../../tests/integration/helpers';
import { JobRunner } from '../framework/runner';
import { communityJobs } from './community';

describe('community worker jobs', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('posts exactly one counts-only raid alert to the mod-log channel per window', async () => {
    const guildId = await freshGuild();
    const modLogChannelId = '333333333333333333';
    await testDb().guildConfig.update({ where: { guildId }, data: { modLogChannelId, logChannelId: '444444444444444444' } });
    await testDb().welcomeConfig.update({ where: { guildId }, data: { raidJoinThreshold: 3, raidWindowSeconds: 600 } });

    const t = Math.ceil(Date.now() / 600_000) * 600_000 + 5_000;
    const deps = testDeps({ now: () => new Date(t) });
    const runner = new JobRunner({ deps, env: { DISCORD_GUILD_ID: guildId } as WorkerEnv, log: silentLog, workerId: 't' }, [communityJobs]);
    const ctx = makeCtx(deps, guildId, systemActor('bot'));
    const joiners: string[] = [];
    for (let n = 0; n < 5; n++) {
      const userId = snowflake();
      joiners.push(userId);
      await community.recordJoin(ctx, { userId, joinedAt: new Date(t), accountCreatedAt: new Date(0) });
    }

    await runner.tick(new Date(t));
    await runner.tick(new Date(t + 1000));
    const alerts = deps.discord.sent.filter((s) => s.channelId === modLogChannelId);
    expect(alerts).toHaveLength(1);
    const body = JSON.stringify(alerts[0]!.body);
    expect(body).toContain('Possible raid detected');
    for (const id of joiners) expect(body).not.toContain(id); // no member lists
    expect(alerts[0]!.body.allowed_mentions).toBeUndefined(); // REST port applies parse:[] by default
  });

  it('skips the alert gracefully when no log channel is configured', async () => {
    const guildId = await freshGuild();
    await testDb().welcomeConfig.update({ where: { guildId }, data: { raidJoinThreshold: 3, raidWindowSeconds: 600 } });
    const t = Math.ceil(Date.now() / 600_000) * 600_000 + 5_000;
    const deps = testDeps({ now: () => new Date(t) });
    const runner = new JobRunner({ deps, env: { DISCORD_GUILD_ID: guildId } as WorkerEnv, log: silentLog, workerId: 't' }, [communityJobs]);
    const ctx = makeCtx(deps, guildId, systemActor('bot'));
    for (let n = 0; n < 3; n++) await community.recordJoin(ctx, { userId: snowflake(), joinedAt: new Date(t), accountCreatedAt: new Date(0) });
    await runner.tick(new Date(t));
    expect(deps.discord.sent).toHaveLength(0);
    const job = await testDb().scheduledJob.findFirst({ where: { guildId, type: community.RAID_ALERT_JOB } });
    expect(job?.status).toBe('DONE');
  });

  it('runs the retention task for the configured guild', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { activityRetentionDays: 1 } });
    const userId = snowflake();
    await testDb().memberEvent.create({ data: { guildId, userId, type: 'JOIN', at: new Date(Date.now() - 3 * 86_400_000) } });
    await testDb().onboardingRecord.create({
      data: { guildId, userId, joinedAt: new Date(Date.now() - 3 * 86_400_000), accountCreatedAt: new Date(0), leftAt: new Date(Date.now() - 2 * 86_400_000) },
    });

    const deps = testDeps();
    const runner = new JobRunner({ deps, env: { DISCORD_GUILD_ID: guildId } as WorkerEnv, log: silentLog, workerId: 't' }, [communityJobs]);
    // A unique far-future bucket so other test runs' periodic jobs don't collide.
    await runner.tick(new Date(Date.now() + 1000 * 6 * 60 * 60_000 + Math.floor(Math.random() * 1e6) * 6 * 60 * 60_000));
    expect(await testDb().memberEvent.count({ where: { guildId } })).toBe(0);
    expect(await testDb().onboardingRecord.count({ where: { guildId } })).toBe(0);
  });
});
