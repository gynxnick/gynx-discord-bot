import type { Logger, WorkerEnv } from '@gynx/config';
import type { ScheduledJob } from '@gynx/database';
import type { DiscordPort, ServiceDeps } from '@gynx/services';

export interface WorkerCtx {
  deps: ServiceDeps & { discord: DiscordPort };
  env: WorkerEnv;
  log: Logger;
  workerId: string;
}

/**
 * Handlers MUST be idempotent: a job can run more than once (crash after side
 * effect, before completion). Check persisted state before acting (e.g.
 * `announcement.status === 'PUBLISHED'` → return) and use idempotency keys.
 * Throw AppError with a non-retryable code for permanent failures.
 */
export type JobHandler = (job: ScheduledJob, w: WorkerCtx) => Promise<void>;

/** A task that runs every `intervalMs`, at most once per interval across all worker instances. */
export interface PeriodicTask {
  name: string;
  intervalMs: number | ((w: WorkerCtx) => number);
  run(w: WorkerCtx, now: Date): Promise<void>;
}

export interface WorkerModule {
  name: string;
  handlers?: Record<string, JobHandler>;
  periodic?: PeriodicTask[];
}
