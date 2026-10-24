import { afterAll, describe, expect, it } from 'vitest';
import { enqueueJob } from '@gynx/services';
import { testDb } from './helpers';

describe('job queue', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('tolerates many workers enqueueing the same logical job at the same instant', async () => {
    const dedupeKey = `race:${Date.now()}:${Math.random()}`;
    const runAt = new Date();
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => enqueueJob(testDb(), { type: 'test.race', dedupeKey, runAt })),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids.size).toBe(1);
    expect(await testDb().scheduledJob.count({ where: { dedupeKey } })).toBe(1);
  });
});
