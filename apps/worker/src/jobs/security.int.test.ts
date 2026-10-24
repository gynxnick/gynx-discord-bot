import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { security } from '@gynx/services';
import { ctxAs, freshGuild, silentLog, testDb, testDeps, drainJobs } from '../../../../tests/integration/helpers';
import { JobRunner } from '../framework/runner';
import { securityJobs } from './security';

describe('security worker jobs', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('notifies the private security channel without revealing the reporter, then DMs the reporter on closure', async () => {
    const guildId = await freshGuild();
    const securityChannelId = '222222222222222222';
    await testDb().guildConfig.update({ where: { guildId }, data: { securityChannelId } });

    const deps = testDeps();
    const runner = new JobRunner(
      { deps, env: { DISCORD_GUILD_ID: guildId, DASHBOARD_URL: 'https://dash.test' } as WorkerEnv, log: silentLog, workerId: 't' },
      [securityJobs],
    );

    const reporter = ctxAs(guildId, [], { deps });
    const report = await security.submitReport(reporter, {
      category: 'IMPERSONATION',
      description: 'Someone is pretending to be a GYNX staff member in DMs.',
    });
    await drainJobs(runner);

    expect(deps.discord.sent).toHaveLength(1);
    expect(deps.discord.sent[0]!.channelId).toBe(securityChannelId);
    expect(JSON.stringify(deps.discord.sent[0]!.body)).not.toContain(reporter.actor.userId);

    const staff = ctxAs(guildId, ['security.reports.view', 'security.reports.manage'], { deps });
    await security.updateReportStatus(staff, report.id, { status: 'DISMISSED', resolution: 'Duplicate of earlier report.' });
    await drainJobs(runner);
    await drainJobs(runner); // idempotent: no second DM
    expect(deps.discord.dms).toHaveLength(1);
    expect(deps.discord.dms[0]!.userId).toBe(reporter.actor.userId);
  });
});
