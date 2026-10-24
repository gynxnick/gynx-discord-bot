import type { analytics } from '@gynx/services';

const MAX_KEYS = 20_000;

/**
 * In-memory message counters, flushed in one batched upsert every 60 s.
 * Stores only (date, channel) and (date, user) counts — never content.
 *
 * Loss model (documented trade-off): counts buffered since the last flush can be lost
 * if the process crashes; on graceful shutdown a best-effort flush is attempted. A failed
 * flush re-queues its counts for the next attempt (bounded by MAX_KEYS).
 */
export class ActivityCollector {
  private channels = new Map<string, number>();
  private users = new Map<string, number>();
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly sink: (batch: analytics.ActivityBatch) => Promise<unknown>,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {}

  get size(): number {
    return this.channels.size + this.users.size;
  }

  record(date: string, channelId: string, userId: string, n = 1): void {
    const ck = `${date}|${channelId}`;
    const uk = `${date}|${userId}`;
    this.channels.set(ck, (this.channels.get(ck) ?? 0) + n);
    this.users.set(uk, (this.users.get(uk) ?? 0) + n);
    if (this.size >= MAX_KEYS) void this.flush();
  }

  /** Take and clear the buffered counts. */
  drain(): analytics.ActivityBatch {
    const split = (k: string) => {
      const i = k.indexOf('|');
      return [k.slice(0, i), k.slice(i + 1)] as const;
    };
    const batch: analytics.ActivityBatch = {
      channels: [...this.channels].map(([k, count]) => {
        const [date, channelId] = split(k);
        return { date, channelId, count };
      }),
      users: [...this.users].map(([k, count]) => {
        const [date, userId] = split(k);
        return { date, userId, count };
      }),
    };
    this.channels = new Map();
    this.users = new Map();
    return batch;
  }

  private requeue(batch: analytics.ActivityBatch): void {
    if (this.size >= MAX_KEYS) return; // drop rather than grow without bound
    for (const c of batch.channels) this.channels.set(`${c.date}|${c.channelId}`, (this.channels.get(`${c.date}|${c.channelId}`) ?? 0) + c.count);
    for (const u of batch.users) this.users.set(`${u.date}|${u.userId}`, (this.users.get(`${u.date}|${u.userId}`) ?? 0) + u.count);
  }

  /** Flush buffered counts; concurrent calls share one in-flight flush. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.size === 0) return Promise.resolve();
    const batch = this.drain();
    this.flushing = this.sink(batch)
      .then(() => undefined)
      .catch((err: unknown) => {
        this.requeue(batch);
        this.onError(err);
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }
}
