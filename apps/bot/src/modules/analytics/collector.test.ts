import { describe, expect, it } from 'vitest';
import type { analytics } from '@gynx/services';
import { ActivityCollector } from './collector';

describe('ActivityCollector', () => {
  it('aggregates counts per (date, channel) and (date, user) and clears on flush', async () => {
    const batches: analytics.ActivityBatch[] = [];
    const c = new ActivityCollector(async (b) => batches.push(b));
    c.record('2026-10-24', '111', 'u1');
    c.record('2026-10-24', '111', 'u1');
    c.record('2026-10-24', '222', 'u2');
    c.record('2026-10-25', '111', 'u1');
    await c.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.channels).toEqual(
      expect.arrayContaining([
        { date: '2026-10-24', channelId: '111', count: 2 },
        { date: '2026-10-24', channelId: '222', count: 1 },
        { date: '2026-10-25', channelId: '111', count: 1 },
      ]),
    );
    expect(batches[0]!.users).toEqual(
      expect.arrayContaining([
        { date: '2026-10-24', userId: 'u1', count: 2 },
        { date: '2026-10-24', userId: 'u2', count: 1 },
        { date: '2026-10-25', userId: 'u1', count: 1 },
      ]),
    );
    expect(c.size).toBe(0);
    await c.flush(); // nothing buffered → no call
    expect(batches).toHaveLength(1);
  });

  it('re-queues counts when a flush fails', async () => {
    let fail = true;
    const seen: analytics.ActivityBatch[] = [];
    const errors: unknown[] = [];
    const c = new ActivityCollector(
      async (b) => {
        if (fail) throw new Error('db down');
        seen.push(b);
      },
      (e) => errors.push(e),
    );
    c.record('2026-10-24', '111', 'u1');
    await c.flush();
    expect(errors).toHaveLength(1);
    c.record('2026-10-24', '111', 'u1');
    fail = false;
    await c.flush();
    expect(seen[0]!.channels).toEqual([{ date: '2026-10-24', channelId: '111', count: 2 }]);
  });
});
