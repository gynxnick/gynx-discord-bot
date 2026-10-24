import { z } from 'zod';
import type { Prisma } from '@gynx/database';
import { audit, requirePermission, retryDeadJob, type Ctx } from '@gynx/services';
import { cursorArgs, invalidState, notFound, paginationSchema, toPage, truncate } from '@gynx/shared';

/**
 * Job-queue visibility for operators (settings.manage). Jobs without a guild
 * (system jobs) are included because a deployment serves a single guild.
 */
export const jobListSchema = paginationSchema.extend({
  status: z.enum(['DEAD', 'FAILED']).optional(),
  sort: z.enum(['updatedAt', 'runAt', 'attempts']).default('updatedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export interface JobView {
  id: string;
  type: string;
  status: 'DEAD' | 'FAILED';
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAt: Date;
  updatedAt: Date;
  createdAt: Date;
}

export async function listProblemJobs(ctx: Ctx, raw: z.input<typeof jobListSchema>) {
  await requirePermission(ctx, 'settings.manage');
  const q = jobListSchema.parse(raw);
  const where: Prisma.ScheduledJobWhereInput = {
    OR: [{ guildId: ctx.guildId }, { guildId: null }],
    status: q.status ? q.status : { in: ['DEAD', 'FAILED'] },
  };
  const rows = await ctx.db.scheduledJob.findMany({
    where,
    orderBy: [{ [q.sort]: q.dir }, { id: q.dir }],
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      lastError: true,
      runAt: true,
      updatedAt: true,
      createdAt: true,
    },
    ...cursorArgs(q),
  });
  const page = toPage(rows, q.limit);
  return {
    ...page,
    // Error text is operator-facing; keep it short (it never contains payloads).
    items: page.items.map(
      (j) => ({ ...j, lastError: j.lastError ? truncate(j.lastError, 300) : null }) as JobView,
    ),
  };
}

/** Requeue a dead-lettered job and audit it in the same transaction. */
export async function retryJob(ctx: Ctx, jobId: string): Promise<{ id: string; status: 'PENDING' }> {
  await requirePermission(ctx, 'settings.manage', 'jobs.retry');
  const job = await ctx.db.scheduledJob.findFirst({
    where: { id: jobId, OR: [{ guildId: ctx.guildId }, { guildId: null }] },
    select: { id: true, type: true, status: true },
  });
  if (!job) throw notFound('Job');
  if (job.status !== 'DEAD') throw invalidState('Only dead-lettered jobs can be retried manually.');
  await ctx.db.$transaction(async (tx) => {
    const ok = await retryDeadJob(tx, job.id, ctx.now());
    if (!ok) throw invalidState('This job is no longer dead-lettered.');
    await audit(
      ctx,
      { action: 'jobs.retry', targetType: 'ScheduledJob', targetId: job.id, metadata: { type: job.type } },
      tx,
    );
  });
  return { id: job.id, status: 'PENDING' };
}
