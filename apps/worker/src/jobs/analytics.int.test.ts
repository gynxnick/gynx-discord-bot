import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { analytics, type MessageBody } from '@gynx/services';
import { freshGuild, silentLog, snowflake, testDb, testDeps } from '../../../../tests/integration/helpers';
import { JobRunner } from '../framework/runner';
import { createAnalyticsJobs } from './analytics';

interface Sent {
  channelId: string;
  body: MessageBody;
  file: analytics.ReportFile;
}

function setup(guildId: string, clock: { now: Date }, sender: analytics.ReportSender, env: Partial<WorkerEnv> = {}) {
  const deps = testDeps({ now: () => clock.now });
  const runner = new JobRunner(
    {
      deps,
      env: {
        DISCORD_GUILD_ID: guildId,
        DASHBOARD_URL: 'https://dash.test',
        WEEKLY_REPORT_ENABLED: true,
        WEEKLY_REPORT_DAY: 'MONDAY',
        WEEKLY_REPORT_TIME: '09:00',
        DEFAULT_TIMEZONE: 'UTC',
        ...env,
      } as WorkerEnv,
      log: silentLog,
      workerId: 't',
    },
    [createAnalyticsJobs({ reportSender: () => sender })],
  );
  return { runner, deps };
}

/** Tick until the queue is idle (other test files may have left due jobs behind). */
async function drain(runner: JobRunner, now: Date): Promise<void> {
  for (let i = 0; i < 50; i++) if ((await runner.tick(now)) === 0) return;
}

describe('analytics worker jobs', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('seeds the default weekly report, generates it when due and delivers summary + .md attachment once', async () => {
    const guildId = await freshGuild();
    const reportChannelId = snowflake();
    await testDb().guildConfig.update({ where: { guildId }, data: { reportChannelId, timezone: 'Europe/London' } });
    const sent: Sent[] = [];
    const sender: analytics.ReportSender = async (channelId, body, file) => {
      sent.push({ channelId, body, file });
      return { id: snowflake() };
    };
    // Unique clock range for this test (periodic buckets are global dedupe keys).
    const clock = { now: new Date('2031-03-05T12:00:00Z') }; // Wednesday
    const { runner } = setup(guildId, clock, sender);

    await drain(runner, clock.now);
    const def = await testDb().reportDefinition.findUniqueOrThrow({ where: { guildId_name: { guildId, name: analytics.DEFAULT_REPORT_NAME } } });
    expect(def).toMatchObject({ day: 'MONDAY', time: '09:00', timezone: 'Europe/London', periodDays: 7, channelId: reportChannelId });
    expect(def.nextRunAt?.toISOString()).toBe('2031-03-10T09:00:00.000Z'); // GMT in March before DST
    expect(await testDb().generatedReport.count({ where: { guildId } })).toBe(0);

    clock.now = new Date('2031-03-10T09:02:00Z');
    await drain(runner, clock.now); // generate + enqueue delivery, then deliver

    const reports = await testDb().generatedReport.findMany({ where: { guildId } });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.periodStart.toISOString()).toBe('2031-03-03T09:00:00.000Z');
    expect(reports[0]!.periodEnd.toISOString()).toBe('2031-03-10T09:00:00.000Z');
    expect(reports[0]!.deliveredAt).not.toBeNull();
    expect(reports[0]!.messageId).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.channelId).toBe(reportChannelId);
    expect(sent[0]!.file.name).toBe('gynx-report-2031-03-03_2031-03-10.md');
    expect(sent[0]!.file.data.toString('utf8')).toContain('## 8. Comparison vs previous period');
    expect(JSON.stringify(sent[0]!.body.embeds)).toContain('Weekly CEO report');

    const updated = await testDb().reportDefinition.findUniqueOrThrow({ where: { id: def.id } });
    expect(updated.lastRunAt?.toISOString()).toBe(clock.now.toISOString());
    expect(updated.nextRunAt?.toISOString()).toBe('2031-03-17T09:00:00.000Z');
  });

  it('retries delivery only (never regenerates) after a failed send', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { reportChannelId: snowflake() } });
    let calls = 0;
    const sender: analytics.ReportSender = async () => {
      calls++;
      if (calls === 1) throw new Error('Missing Access');
      return { id: snowflake() };
    };
    const clock = { now: new Date('2032-06-02T12:00:00Z') };
    const { runner } = setup(guildId, clock, sender);
    await drain(runner, clock.now); // seed definition

    clock.now = new Date('2032-06-07T09:01:00Z'); // Monday after 09:00 UTC
    await drain(runner, clock.now);
    const failed = await testDb().generatedReport.findFirstOrThrow({ where: { guildId } });
    expect(failed.deliveredAt).toBeNull();
    expect(failed.deliveryError).toContain('Missing Access');
    const job = await testDb().scheduledJob.findUniqueOrThrow({ where: { dedupeKey: analytics.deliverDedupeKey(failed.id) } });
    expect(job.status).toBe('FAILED');

    // After the backoff the delivery job runs again; generation is not repeated.
    clock.now = new Date(job.runAt.getTime() + 1000);
    await drain(runner, clock.now);
    const reports = await testDb().generatedReport.findMany({ where: { guildId } });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.id).toBe(failed.id);
    expect(reports[0]!.createdAt.toISOString()).toBe(failed.createdAt.toISOString());
    expect(reports[0]!.deliveredAt).not.toBeNull();
    expect(reports[0]!.deliveryError).toBeNull();
    expect(calls).toBe(2);
  });

  it('records a missing report channel without retrying, and runs the daily rollup', async () => {
    const guildId = await freshGuild();
    const sender: analytics.ReportSender = async () => ({ id: snowflake() });
    const clock = { now: new Date('2033-01-05T12:00:00Z') };
    const { runner } = setup(guildId, clock, sender);
    await drain(runner, clock.now);
    expect(await testDb().analyticsDaily.count({ where: { guildId } })).toBe(2); // yesterday + today

    clock.now = new Date('2033-01-10T09:30:00Z');
    await drain(runner, clock.now);
    const r = await testDb().generatedReport.findFirstOrThrow({ where: { guildId } });
    expect(r.deliveredAt).toBeNull();
    expect(r.deliveryError).toMatch(/No report channel configured/);
    const job = await testDb().scheduledJob.findUniqueOrThrow({ where: { dedupeKey: analytics.deliverDedupeKey(r.id) } });
    expect(job.status).toBe('DONE');
  });
});
