import { Prisma, isUniqueViolation, type Db, type PrismaClient, type ScheduledJob } from '@gynx/database';

/**
 * Durable job queue on PostgreSQL.
 *
 * - `enqueueJob` is idempotent by `dedupeKey` (e.g. `announcement.publish:<id>:v3`).
 * - `claimJobs` uses FOR UPDATE SKIP LOCKED so concurrent workers never claim the same job.
 * - Failures back off exponentially with jitter; after `maxAttempts` a job is DEAD
 *   (dead-letter) and surfaced on the dashboard for manual recovery.
 * - Jobs stuck RUNNING (crashed worker) are reclaimed after `staleAfterMs`.
 */
export interface EnqueueInput {
  type: string;
  dedupeKey: string;
  runAt: Date;
  guildId?: string | null;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

export async function enqueueJob(db: Db, input: EnqueueInput): Promise<ScheduledJob> {
  try {
    return await upsertJob(db, input);
  } catch (e) {
    // Prisma's upsert is select-then-insert here, so two workers enqueueing the same
    // logical job at the same instant race on the unique dedupeKey. The job exists: done.
    if (!isUniqueViolation(e)) throw e;
    return db.scheduledJob.findUniqueOrThrow({ where: { dedupeKey: input.dedupeKey } });
  }
}

function upsertJob(db: Db, input: EnqueueInput): Promise<ScheduledJob> {
  return db.scheduledJob.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      type: input.type,
      dedupeKey: input.dedupeKey,
      runAt: input.runAt,
      guildId: input.guildId ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      maxAttempts: input.maxAttempts ?? 5,
    },
    // Re-enqueueing an existing logical job only reschedules it if it hasn't run yet.
    update: {},
  });
}

/** Reschedule a pending job (e.g. announcement edited before publication). */
export async function rescheduleJob(db: Db, dedupeKey: string, runAt: Date): Promise<boolean> {
  const r = await db.scheduledJob.updateMany({ where: { dedupeKey, status: 'PENDING' }, data: { runAt } });
  return r.count > 0;
}

export async function cancelJob(db: Db, dedupeKey: string): Promise<boolean> {
  const r = await db.scheduledJob.updateMany({
    where: { dedupeKey, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'CANCELLED' },
  });
  return r.count > 0;
}

export async function cancelJobsByPrefix(db: Db, prefix: string): Promise<number> {
  const r = await db.scheduledJob.updateMany({
    where: { dedupeKey: { startsWith: prefix }, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'CANCELLED' },
  });
  return r.count;
}

/**
 * Prisma stores DateTime as `timestamp(3)` (no zone) in UTC, but raw-query Date
 * parameters are sent as timestamptz and would be shifted by the session TimeZone.
 * Always convert explicitly in raw SQL.
 */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export async function claimJobs(
  db: PrismaClient,
  workerId: string,
  now: Date,
  limit = 10,
  staleAfterMs = 10 * 60_000,
  /**
   * Only claim these job types (the ones this worker has handlers for). Prevents an
   * older worker from dead-lettering job types introduced by a newer release during
   * a rolling deploy.
   */
  types?: readonly string[],
): Promise<ScheduledJob[]> {
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const typeFilter = types ? Prisma.sql`AND "type" = ANY(${[...types]}::text[])` : Prisma.empty;
  return db.$queryRaw<ScheduledJob[]>`
    UPDATE "ScheduledJob" SET "status" = 'RUNNING', "lockedAt" = ${utc(now)}, "lockedBy" = ${workerId},
      "attempts" = "attempts" + 1, "updatedAt" = ${utc(now)}
    WHERE "id" IN (
      SELECT "id" FROM "ScheduledJob"
      WHERE (("status" IN ('PENDING', 'FAILED') AND "runAt" <= ${utc(now)})
          OR ("status" = 'RUNNING' AND "lockedAt" < ${utc(staleBefore)}))
        ${typeFilter}
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export async function completeJob(db: Db, id: string, now: Date): Promise<void> {
  await db.scheduledJob.update({
    where: { id },
    data: { status: 'DONE', completedAt: now, lockedAt: null, lockedBy: null, lastError: null },
  });
}

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
  return Math.round(base / 2 + random() * (base / 2)); // "equal jitter"
}

export async function failJob(
  db: Db,
  job: Pick<ScheduledJob, 'id' | 'attempts' | 'maxAttempts'>,
  error: string,
  now: Date,
  retryable: boolean,
): Promise<'retry' | 'dead'> {
  const dead = !retryable || job.attempts >= job.maxAttempts;
  await db.scheduledJob.update({
    where: { id: job.id },
    data: {
      status: dead ? 'DEAD' : 'FAILED',
      lastError: error.slice(0, 1000),
      lockedAt: null,
      lockedBy: null,
      runAt: dead ? undefined : new Date(now.getTime() + backoffMs(job.attempts)),
    },
  });
  return dead ? 'dead' : 'retry';
}

/** Manually requeue a dead-lettered job (dashboard recovery action). */
export async function retryDeadJob(db: Db, id: string, now: Date): Promise<boolean> {
  const r = await db.scheduledJob.updateMany({
    where: { id, status: 'DEAD' },
    data: { status: 'PENDING', attempts: 0, runAt: now, lastError: null },
  });
  return r.count > 0;
}
