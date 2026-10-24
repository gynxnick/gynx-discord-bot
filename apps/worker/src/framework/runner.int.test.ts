import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { enqueueJob } from '@gynx/services';
import { AppError } from '@gynx/shared';
import { freshGuild, silentLog, testDb, testDeps } from '../../../../tests/integration/helpers';
import { JobRunner } from './runner';
import type { WorkerCtx, WorkerModule } from './types';

function worker(id: string): WorkerCtx {
  return {
    deps: testDeps(),
    env: { DISCORD_GUILD_ID: '1', DASHBOARD_URL: 'https://dash.test' } as WorkerEnv,
    log: silentLog,
    workerId: id,
  };
}

describe('JobRunner', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('runs each periodic bucket exactly once across concurrent workers', async () => {
    let runs = 0;
    const name = `test.periodic.${Date.now()}`;
    const mod: WorkerModule = {
      name: 'test',
      periodic: [{ name, intervalMs: 60_000, run: async () => void runs++ }],
    };
    const now = new Date();
    const a = new JobRunner(worker('a'), [mod]);
    const b = new JobRunner(worker('b'), [mod]);
    await Promise.all([a.tick(now), b.tick(now), a.tick(now), b.tick(now)]);
    expect(runs).toBe(1);
  });

  it('runs a one-off job once even if enqueued repeatedly, and retries transient failures', async () => {
    const guildId = await freshGuild();
    const type = `test.job.${Date.now()}`;
    let calls = 0;
    const mod: WorkerModule = {
      name: 'test',
      handlers: {
        [type]: async () => {
          calls++;
          if (calls === 1) throw new AppError('INTEGRATION', 'discord unavailable');
        },
      },
    };
    const now = new Date();
    for (let i = 0; i < 3; i++)
      await enqueueJob(testDb(), { type, dedupeKey: `${type}:x`, runAt: now, guildId });

    const r = new JobRunner(worker('c'), [mod]);
    await r.tick(now);
    let job = await testDb().scheduledJob.findUniqueOrThrow({ where: { dedupeKey: `${type}:x` } });
    expect(job.status).toBe('FAILED');
    expect(job.runAt.getTime()).toBeGreaterThan(now.getTime()); // backed off

    await r.tick(new Date(job.runAt.getTime() + 1));
    job = await testDb().scheduledJob.findUniqueOrThrow({ where: { dedupeKey: `${type}:x` } });
    expect(job.status).toBe('DONE');
    expect(calls).toBe(2);
  });

  it('dead-letters permanent failures without retrying', async () => {
    const type = `test.perm.${Date.now()}`;
    const mod: WorkerModule = {
      name: 'test',
      handlers: { [type]: async () => Promise.reject(new AppError('VALIDATION', 'bad payload')) },
    };
    const now = new Date();
    await enqueueJob(testDb(), { type, dedupeKey: `${type}:y`, runAt: now });
    await new JobRunner(worker('d'), [mod]).tick(now);
    const job = await testDb().scheduledJob.findUniqueOrThrow({ where: { dedupeKey: `${type}:y` } });
    expect(job.status).toBe('DEAD');
    expect(job.attempts).toBe(1);
  });
});
