import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { moderation } from '@gynx/services';
import { ctxAs, freshGuild, silentLog, snowflake, testDb, testDeps, drainJobs } from '../../../../tests/integration/helpers';
import type { WorkerCtx } from '../framework/types';
import { JobRunner } from '../framework/runner';
import { createModerationJobs } from './moderation';

const subject: moderation.HierarchySubject = { actorHighest: 10, targetHighest: 1, botHighest: 20, guildOwnerId: '100000000000000000' };

function setup(guildId: string) {
  let clock = new Date();
  const deps = testDeps({ now: () => clock });
  const unbans: Array<{ guildId: string; userId: string }> = [];
  const w: WorkerCtx = { deps, env: { DISCORD_GUILD_ID: guildId, DISCORD_BOT_TOKEN: 'x'.repeat(60) } as WorkerEnv, log: silentLog, workerId: 't' };
  const jobs = createModerationJobs({
    unban: async (_w, g, userId) => {
      unbans.push({ guildId: g, userId });
    },
  });
  const runner = new JobRunner(w, [jobs]);
  return { deps, w, jobs, runner, unbans, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)), now: () => clock };
}

describe('moderation worker jobs', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('posts the modlog entry exactly once', async () => {
    const guildId = await freshGuild();
    const modLogChannelId = snowflake();
    await testDb().guildConfig.update({ where: { guildId }, data: { modLogChannelId } });
    const { deps, runner } = setup(guildId);
    const mod = ctxAs(guildId, ['moderation.execute'], { deps });
    const plan = await moderation.prepareAction(mod, { type: 'KICK', targetId: snowflake(), reason: 'Spamming @everyone' }, subject);
    const { action } = await moderation.recordAction(mod, plan, { applied: true, dmSent: true });
    // Re-enqueue attempt is a no-op thanks to the dedupe key
    await drainJobs(runner);
    await drainJobs(runner);
    expect(deps.discord.sent).toHaveLength(1);
    expect(deps.discord.sent[0]!.channelId).toBe(modLogChannelId);
    const json = JSON.stringify(deps.discord.sent[0]!.body);
    expect(json).toContain(action.ref);
    // neutraliseMentions inserts a zero-width space after "@"
    expect(json).not.toContain('"Spamming @everyone"');
  });

  it('expires a temp ban idempotently: one unban call, one UNBAN record', async () => {
    const guildId = await freshGuild();
    const { deps, w, jobs, runner, unbans, advance, now } = setup(guildId);
    const mod = ctxAs(guildId, ['moderation.execute', 'moderation.ban'], { deps });
    const target = snowflake();
    const plan = await moderation.prepareAction(mod, { type: 'BAN', targetId: target, reason: 'raid', duration: '1h' }, subject);
    const { action } = await moderation.recordAction(mod, plan, { applied: true, dmSent: false });

    await drainJobs(runner); // not yet due
    expect(unbans).toHaveLength(0);

    advance(61 * 60_000);
    await drainJobs(runner, now());
    const job = await testDb().scheduledJob.findUniqueOrThrow({ where: { dedupeKey: `moderation.expire:${action.id}` } });
    expect(job.status).toBe('DONE');
    // Run the handler again (simulated redelivery)
    await jobs.handlers!['moderation.expire']!(job, w);

    expect(unbans).toEqual([{ guildId, userId: target }]);
    expect((await testDb().moderationAction.findUniqueOrThrow({ where: { id: action.id } })).status).toBe('EXPIRED');
    const unbanRows = await testDb().moderationAction.findMany({ where: { guildId, targetId: target, type: 'UNBAN' } });
    expect(unbanRows).toHaveLength(1);
    expect(unbanRows[0]!.moderatorId).toBe('system');
  });

  it('expires timeouts without calling Discord', async () => {
    const guildId = await freshGuild();
    const { deps, runner, unbans, advance, now } = setup(guildId);
    const mod = ctxAs(guildId, ['moderation.execute'], { deps });
    const plan = await moderation.prepareAction(mod, { type: 'TIMEOUT', targetId: snowflake(), reason: 'spam', duration: '10m' }, subject);
    const { action } = await moderation.recordAction(mod, plan, { applied: true, dmSent: false });
    advance(11 * 60_000);
    await drainJobs(runner, now());
    expect((await testDb().moderationAction.findUniqueOrThrow({ where: { id: action.id } })).status).toBe('EXPIRED');
    expect(unbans).toHaveLength(0);
  });

  it('posts appeals for review and DMs the decision once', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { modLogChannelId: snowflake(), supportUrl: 'https://support.gynx.gg' } });
    const { deps, runner } = setup(guildId);
    const mod = ctxAs(guildId, ['moderation.execute'], { deps });
    const memberId = snowflake();
    const { action } = await moderation.recordAction(
      mod,
      await moderation.prepareAction(mod, { type: 'WARN', targetId: memberId, reason: 'rude' }, subject),
      { applied: true, dmSent: true },
    );
    const appeal = await moderation.submitAppeal(ctxAs(guildId, [], { deps, userId: memberId }), {
      actionRef: action.ref,
      statement: 'I misunderstood the rule, it will not happen again.',
    });
    await drainJobs(runner);
    const card = deps.discord.sent.find((s) => JSON.stringify(s.body).includes(`modappeal:accept:${appeal.id}`));
    expect(card).toBeDefined();

    await moderation.reviewAppeal(mod, appeal.id, { decision: 'DENIED', note: 'Rule is clear.' });
    await drainJobs(runner);
    await drainJobs(runner);
    expect(deps.discord.dms).toHaveLength(1);
    expect(deps.discord.dms[0]!.userId).toBe(memberId);
    expect(JSON.stringify(deps.discord.dms[0]!.body)).toContain('https://support.gynx.gg');
  });

  it('periodically deactivates expired warnings', async () => {
    const guildId = await freshGuild();
    const { deps, w, jobs } = setup(guildId);
    const mod = ctxAs(guildId, ['moderation.execute'], { deps });
    const userId = snowflake();
    const { action } = await moderation.recordAction(
      mod,
      await moderation.prepareAction(mod, { type: 'WARN', targetId: userId, reason: 'rude' }, subject),
      { applied: true, dmSent: true },
    );
    await testDb().warning.update({ where: { actionId: action.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await jobs.periodic![0]!.run(w, new Date());
    expect((await testDb().warning.findUniqueOrThrow({ where: { actionId: action.id } })).active).toBe(false);
  });
});
