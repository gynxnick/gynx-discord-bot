import { z } from 'zod';
import type { AppealStatus, ModerationAction, ModerationAppeal, Prisma } from '@gynx/database';
import {
  conflict,
  cursorArgs,
  forbidden,
  invalidState,
  notFound,
  paginationSchema,
  redactSecrets,
  toPage,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { requireAny, requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { enqueueJob } from '../core/jobs';
import { parseInput } from './common';

/**
 * Appeals. Members appeal their own warnings, timeouts and kicks with /appeal.
 * Banned users cannot run commands in the guild, so BAN appeals are handled by
 * the external support system (`GuildConfig.supportUrl`) — the ban DM links it.
 * The service still accepts ban appeals (e.g. from a future dashboard flow) and
 * requires `moderation.ban` to review them.
 */
export const submitAppealSchema = z.object({
  actionRef: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^M-\d{1,9}$/, 'Action references look like M-0042')
    .optional(),
  statement: z.string().trim().min(20, 'Please explain your appeal (at least 20 characters).').max(2000),
});
export type SubmitAppealInput = z.input<typeof submitAppealSchema>;

const APPEALABLE = new Set(['WARN', 'TIMEOUT', 'KICK', 'BAN']);

export async function submitAppeal(ctx: Ctx, raw: SubmitAppealInput): Promise<ModerationAppeal> {
  await requireModule(ctx, 'moderation');
  const input = parseInput(submitAppealSchema, raw);
  await requireRate(ctx, 'moderation.appeal', 2, 3600);

  let action: ModerationAction | null = null;
  if (input.actionRef) {
    action = await ctx.db.moderationAction.findFirst({
      where: { guildId: ctx.guildId, ref: input.actionRef },
    });
    // Same error whether it doesn't exist or belongs to someone else: no enumeration of others' records.
    if (!action || action.targetId !== ctx.actor.userId)
      throw notFound('A moderation action with that reference on your account');
    if (!APPEALABLE.has(action.type)) throw invalidState('That action cannot be appealed.');
    if (action.status !== 'APPLIED')
      throw invalidState('That action is no longer in effect, so there is nothing to appeal.');
  }

  const appeal = await ctx.db.$transaction(async (tx) => {
    // No DB unique constraint covers "one PENDING appeal per action", so serialise per user+action.
    const lockKey = `appeal:${ctx.guildId}:${ctx.actor.userId}:${action?.id ?? 'general'}`;
    await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const pending = await tx.moderationAppeal.findFirst({
      where: {
        guildId: ctx.guildId,
        userId: ctx.actor.userId,
        actionId: action?.id ?? null,
        status: 'PENDING',
      },
      select: { id: true },
    });
    if (pending)
      throw conflict(
        action
          ? `You already have a pending appeal for ${action.ref}.`
          : 'You already have a pending appeal.',
      );
    const created = await tx.moderationAppeal.create({
      data: {
        guildId: ctx.guildId,
        userId: ctx.actor.userId,
        actionId: action?.id ?? null,
        statement: redactSecrets(input.statement, { maskIps: false }),
      },
    });
    await audit(
      ctx,
      {
        action: 'moderation.appeal.submit',
        targetType: 'ModerationAppeal',
        targetId: created.id,
        metadata: { actionRef: action?.ref ?? null },
      },
      tx,
    );
    await enqueueJob(tx, {
      type: 'moderation.appeal-notify',
      dedupeKey: `moderation.appeal-notify:${created.id}`,
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { appealId: created.id },
    });
    return created;
  });
  return appeal;
}

export const reviewAppealSchema = z.object({
  decision: z.enum(['ACCEPTED', 'DENIED']),
  note: z.string().trim().max(1000).optional(),
});

export interface ReviewedAppeal {
  appeal: ModerationAppeal;
  /** True when the decision needs a manual Discord change (e.g. remove a timeout / unban). */
  requiresManualReversal: boolean;
}

/**
 * Staff decision. Ban appeals need `moderation.ban`, all others `moderation.execute`.
 * Accepting a WARN appeal revokes the warning; other accepted types are flagged
 * for manual reversal on Discord. The appellant is DMed via a worker job.
 */
export async function reviewAppeal(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof reviewAppealSchema>,
): Promise<ReviewedAppeal> {
  const input = parseInput(reviewAppealSchema, raw);
  const appeal = await ctx.db.moderationAppeal.findFirst({
    where: { id, guildId: ctx.guildId },
    include: { action: true },
  });
  if (!appeal) {
    await requireAny(ctx, ['moderation.execute', 'moderation.ban'], 'moderation.appeal.review');
    throw notFound('Appeal');
  }
  await requirePermission(
    ctx,
    appeal.action?.type === 'BAN' ? 'moderation.ban' : 'moderation.execute',
    'moderation.appeal.review',
  );
  if (appeal.userId === ctx.actor.userId) throw forbidden('You cannot review your own appeal.');
  if (appeal.status !== 'PENDING') throw invalidState('This appeal has already been reviewed.');

  const note = input.note ? redactSecrets(input.note, { maskIps: false }) : null;
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.moderationAppeal.updateMany({
      where: { id: appeal.id, status: 'PENDING' },
      data: { status: input.decision, reviewerId: ctx.actor.userId, reviewNote: note, reviewedAt: ctx.now() },
    });
    if (res.count === 0) throw conflict('Someone else just reviewed this appeal.');

    let requiresManualReversal = false;
    if (input.decision === 'ACCEPTED' && appeal.action && appeal.action.status === 'APPLIED') {
      if (appeal.action.type === 'WARN') {
        await tx.warning.updateMany({
          where: { actionId: appeal.action.id, active: true },
          data: { active: false },
        });
        await tx.moderationAction.update({ where: { id: appeal.action.id }, data: { status: 'REVERSED' } });
      } else if (appeal.action.type === 'TIMEOUT' || appeal.action.type === 'BAN') {
        requiresManualReversal = true;
      }
    }
    await audit(
      ctx,
      {
        action: 'moderation.appeal.review',
        targetType: 'ModerationAppeal',
        targetId: appeal.id,
        metadata: { decision: input.decision, actionRef: appeal.action?.ref ?? null, requiresManualReversal },
      },
      tx,
    );
    await enqueueJob(tx, {
      type: 'moderation.appeal-decision-dm',
      dedupeKey: `moderation.appeal-decision-dm:${appeal.id}`,
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { appealId: appeal.id },
    });
    const updated = await tx.moderationAppeal.findUniqueOrThrow({ where: { id: appeal.id } });
    return { appeal: updated, requiresManualReversal };
  });
}

export const listAppealsSchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'ACCEPTED', 'DENIED']).optional(),
  userId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
});

export async function listAppeals(
  ctx: Ctx,
  raw: z.input<typeof listAppealsSchema>,
): Promise<Page<ModerationAppeal & { action: Pick<ModerationAction, 'ref' | 'type' | 'reason'> | null }>> {
  await requireAny(
    ctx,
    ['moderation.execute', 'moderation.ban', 'moderation.audit.view'],
    'moderation.appeals.view',
  );
  const f = parseInput(listAppealsSchema, raw);
  const where: Prisma.ModerationAppealWhereInput = {
    guildId: ctx.guildId,
    status: f.status as AppealStatus | undefined,
    userId: f.userId,
  };
  const rows = await ctx.db.moderationAppeal.findMany({
    where,
    include: { action: { select: { ref: true, type: true, reason: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}
