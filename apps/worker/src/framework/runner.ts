import { claimJobs, completeJob, enqueueJob, failJob, withGuildText } from '@gynx/services';
import { isAppError } from '@gynx/shared';
import type { JobHandler, PeriodicTask, WorkerCtx, WorkerModule } from './types';

/** Each periodic task has its own job type so workers only claim tasks they know. */
const periodicType = (name: string) => `periodic:${name}`;

/**
 * Single loop driving both one-off jobs and periodic tasks via the ScheduledJob table.
 * Periodic tasks are enqueued with type `periodic:<name>` and dedupeKey `periodic:<name>:<bucket>`
 * (bucket = floor(now / interval)),
 * so every worker instance may enqueue them but the unique dedupeKey + SKIP LOCKED claim
 * guarantee exactly one execution per interval.
 */
export class JobRunner {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly periodic = new Map<string, PeriodicTask>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly w: WorkerCtx,
    modules: WorkerModule[],
    private readonly pollMs = 5_000,
  ) {
    for (const m of modules) {
      for (const [type, handler] of Object.entries(m.handlers ?? {})) {
        if (this.handlers.has(type)) throw new Error(`Duplicate job handler: ${type}`);
        this.handlers.set(type, handler);
      }
      for (const t of m.periodic ?? []) {
        if (this.periodic.has(t.name)) throw new Error(`Duplicate periodic task: ${t.name}`);
        this.periodic.set(t.name, t);
      }
    }
  }

  /** Job types this runner may claim: its handlers plus its periodic tasks. */
  private get claimableTypes(): string[] {
    return [...this.handlers.keys(), ...[...this.periodic.keys()].map(periodicType)];
  }

  get jobTypes(): string[] {
    return [...this.handlers.keys()];
  }

  get periodicNames(): string[] {
    return [...this.periodic.keys()];
  }

  start(): void {
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      this.inFlight = this.tick().then(
        () => undefined,
        (err: unknown) => this.w.log.error({ err }, 'runner tick failed'),
      );
      await this.inFlight;
      if (this.running) this.timer = setTimeout(loop, this.pollMs);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  /** One iteration: enqueue due periodic buckets, then claim and run due jobs. Exposed for tests. */
  async tick(now = this.w.deps.now()): Promise<number> {
    const { db } = this.w.deps;
    for (const t of this.periodic.values()) {
      const interval = typeof t.intervalMs === 'function' ? t.intervalMs(this.w) : t.intervalMs;
      const bucket = Math.floor(now.getTime() / interval);
      await enqueueJob(db, {
        type: periodicType(t.name),
        dedupeKey: `periodic:${t.name}:${bucket}`,
        runAt: new Date(bucket * interval),
        payload: { task: t.name },
        maxAttempts: 1, // the next bucket is the retry
      });
    }

    const jobs = await claimJobs(db, this.w.workerId, now, 10, undefined, this.claimableTypes);
    for (const job of jobs) {
      const log = this.w.log.child({ jobId: job.id, type: job.type, attempt: job.attempts });
      try {
        // Jobs render with the server's custom bot text (Settings → Bot text) in scope.
        await withGuildText(db, job.guildId ?? this.w.env.DISCORD_GUILD_ID, async () => {
          if (job.type.startsWith('periodic:')) {
            const name = job.type.slice('periodic:'.length);
            const task = this.periodic.get(name);
            if (!task) throw new Error(`unknown periodic task ${name}`);
            await task.run(this.w, now);
          } else {
            const handler = this.handlers.get(job.type);
            if (!handler) throw new Error(`no handler for job type ${job.type}`);
            await handler(job, this.w);
          }
        });
        await completeJob(db, job.id, this.w.deps.now());
        log.debug('job done');
      } catch (err) {
        const retryable = isAppError(err) ? err.retryable : !String(err).includes('no handler');
        const outcome = await failJob(
          db,
          job,
          err instanceof Error ? err.message : String(err),
          this.w.deps.now(),
          retryable,
        );
        if (outcome === 'dead') log.error({ err }, 'job dead-lettered');
        else log.warn({ err }, 'job failed, will retry');
      }
    }
    return jobs.length;
  }
}
