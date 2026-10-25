import { z } from 'zod';
import { isUniqueViolation, type Db, type Giveaway, type GiveawayDraw, type Prisma } from '@gynx/database';
import {
  conflict,
  cursorArgs,
  invalidState,
  notFound,
  paginationSchema,
  toPage,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { cancelJob, enqueueJob } from '../core/jobs';
import { JOBS, cleanText, lockRow, refreshBucket, snowflakeSchema } from './common';
import { drawWinners, verifyDraw, type DrawVerification } from './draw';
import { EngagementText as T } from './texts';

// Giveaways are free community prizes only: there is deliberately no purchase,
// payment or paid-entry concept anywhere in this module.

export const GIVEAWAY_MIN_DURATION_MS = 60_000;
export const GIVEAWAY_MAX_DURATION_MS = 30 * 86_400_000;

// ─── Pure rules ─────────────────────────────────────────────────────────────

export interface MemberEligibilityInfo {
  roleIds: readonly string[];
  accountCreatedAt: Date;
  joinedAt: Date | null;
}

export function checkGiveawayEligibility(
  g: Pick<Giveaway, 'requiredRoleIds' | 'minAccountAgeDays' | 'minMemberDays'>,
  m: MemberEligibilityInfo,
  now: Date,
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const days = (d: Date) => (now.getTime() - d.getTime()) / 86_400_000;
  if (g.requiredRoleIds.length > 0 && !g.requiredRoleIds.some((r) => m.roleIds.includes(r))) {
    reasons.push(T.giveawayEligibilityRole({ roles: g.requiredRoleIds.map((r) => `<@&${r}>`).join(', ') }));
  }
  if (g.minAccountAgeDays > 0 && days(m.accountCreatedAt) < g.minAccountAgeDays) {
    reasons.push(T.giveawayEligibilityAccountAge({ days: g.minAccountAgeDays }));
  }
  if (g.minMemberDays > 0 && (!m.joinedAt || days(m.joinedAt) < g.minMemberDays)) {
    reasons.push(T.giveawayEligibilityMemberDays({ days: g.minMemberDays }));
  }
  return { eligible: reasons.length === 0, reasons };
}

// ─── Schemas ────────────────────────────────────────────────────────────────

export const createGiveawaySchema = z.object({
  prize: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  winnerCount: z.number().int().min(1).max(20).default(1),
  durationMs: z
    .number()
    .int()
    .min(GIVEAWAY_MIN_DURATION_MS, 'Minimum duration is 1 minute.')
    .max(GIVEAWAY_MAX_DURATION_MS, 'Maximum duration is 30 days.'),
  requiredRoleIds: z.array(snowflakeSchema).max(5).default([]),
  minAccountAgeDays: z.number().int().min(0).max(3650).default(0),
  minMemberDays: z.number().int().min(0).max(3650).default(0),
  channelId: snowflakeSchema,
});
export type CreateGiveawayInput = z.input<typeof createGiveawaySchema>;

const endKey = (id: string) => `${JOBS.giveawayEnd}:${id}`;

async function loadGiveaway(ctx: Ctx, id: string, db: Db = ctx.db): Promise<Giveaway> {
  const g = await db.giveaway.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!g) throw notFound('Giveaway');
  return g;
}

export async function enqueueGiveawayRefresh(ctx: Ctx, tx: Db, id: string, immediate = false): Promise<void> {
  const { bucket, runAt } = refreshBucket(ctx.now(), 30_000);
  await enqueueJob(tx, {
    type: JOBS.giveawayRefresh,
    dedupeKey: immediate
      ? `${JOBS.giveawayRefresh}:${id}:now:${ctx.now().getTime()}`
      : `${JOBS.giveawayRefresh}:${id}:${bucket}`,
    runAt: immediate ? ctx.now() : runAt,
    guildId: ctx.guildId,
    payload: { giveawayId: id },
  });
}

// ─── Staff operations (giveaways.manage) ────────────────────────────────────

export async function createGiveaway(ctx: Ctx, raw: CreateGiveawayInput): Promise<Giveaway> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'giveaways.manage', 'engagement.giveaway.create');
  const input = createGiveawaySchema.parse(raw);
  const now = ctx.now();
  const endsAt = new Date(now.getTime() + input.durationMs);
  return ctx.db.$transaction(async (tx) => {
    const g = await tx.giveaway.create({
      data: {
        guildId: ctx.guildId,
        prize: cleanText(input.prize),
        description: input.description ? cleanText(input.description) : null,
        winnerCount: input.winnerCount,
        startsAt: now,
        endsAt,
        status: 'ACTIVE',
        requiredRoleIds: [...new Set(input.requiredRoleIds)],
        minAccountAgeDays: input.minAccountAgeDays,
        minMemberDays: input.minMemberDays,
        channelId: input.channelId,
        createdById: ctx.actor.userId,
      },
    });
    await audit(
      ctx,
      {
        action: 'engagement.giveaway.create',
        targetType: 'Giveaway',
        targetId: g.id,
        metadata: { prize: g.prize, winnerCount: g.winnerCount, endsAt: endsAt.toISOString() },
      },
      tx,
    );
    await enqueueJob(tx, {
      type: JOBS.giveawayPublish,
      dedupeKey: `${JOBS.giveawayPublish}:${g.id}`,
      runAt: now,
      guildId: ctx.guildId,
      payload: { giveawayId: g.id },
    });
    await enqueueJob(tx, {
      type: JOBS.giveawayEnd,
      dedupeKey: endKey(g.id),
      runAt: endsAt,
      guildId: ctx.guildId,
      payload: { giveawayId: g.id },
    });
    return g;
  });
}

export interface FinishResult {
  giveaway: Giveaway;
  /** The INITIAL draw, or null when this call did not end the giveaway (already ended). */
  draw: GiveawayDraw | null;
}

/**
 * End a giveaway and perform the INITIAL draw. Idempotent: the ACTIVE→ENDED conditional
 * update succeeds for exactly one caller, and only that caller draws; the (giveawayId, seq)
 * unique constraint is a second guard. Used by the end job and by staff `/giveaway end`.
 */
export async function finishGiveaway(ctx: Ctx, id: string): Promise<FinishResult> {
  await requirePermission(ctx, 'giveaways.manage', 'engagement.giveaway.end');
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.giveaway.updateMany({
      where: { id, guildId: ctx.guildId, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: ctx.now() },
    });
    const giveaway = await loadGiveaway(ctx, id, tx);
    if (res.count === 0) return { giveaway, draw: null };

    const entries = await tx.giveawayEntry.findMany({
      where: { giveawayId: id },
      orderBy: { userId: 'asc' },
      select: { userId: true },
    });
    const result = drawWinners(
      entries.map((e) => e.userId),
      giveaway.winnerCount,
    );
    const draw = await tx.giveawayDraw.create({
      data: {
        giveawayId: id,
        seq: 1,
        kind: 'INITIAL',
        winnerIds: result.winnerIds,
        entrantCount: result.entrantCount,
        entrantsHash: result.entrantsHash,
        algorithm: result.algorithm,
        drawnById: ctx.actor.userId,
      },
    });
    await audit(
      ctx,
      {
        action: 'engagement.giveaway.draw',
        targetType: 'Giveaway',
        targetId: id,
        metadata: {
          seq: 1,
          kind: 'INITIAL',
          winners: result.winnerIds.length,
          entrantCount: result.entrantCount,
          entrantsHash: result.entrantsHash,
          algorithm: result.algorithm,
        },
      },
      tx,
    );
    await cancelJob(tx, endKey(id));
    await enqueueJob(tx, {
      type: JOBS.giveawayAnnounce,
      dedupeKey: `${JOBS.giveawayAnnounce}:${draw.id}`,
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { drawId: draw.id },
    });
    return { giveaway, draw };
  });
}

/** Staff: end now (before the scheduled time). */
export async function endGiveaway(ctx: Ctx, id: string): Promise<FinishResult> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'giveaways.manage', 'engagement.giveaway.end');
  const g = await loadGiveaway(ctx, id);
  if (g.status !== 'ACTIVE') throw invalidState(T.giveawayAlreadyStatus({ status: g.status.toLowerCase() }));
  const r = await finishGiveaway(ctx, id);
  if (!r.draw) throw invalidState(T.giveawayAlreadyEnded());
  return r;
}

export const rerollSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required for a reroll.').max(500),
  count: z.number().int().min(1).max(20).optional(),
});

/** Draw replacement winner(s), excluding everyone who has already won this giveaway. */
export async function rerollGiveaway(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof rerollSchema>,
): Promise<GiveawayDraw> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'giveaways.manage', 'engagement.giveaway.reroll');
  const input = rerollSchema.parse(raw);
  await requireRate(ctx, 'engagement.giveaway.reroll', 5, 300);

  return ctx.db.$transaction(async (tx) => {
    if (!(await lockRow(tx, 'Giveaway', id))) throw notFound('Giveaway');
    const g = await loadGiveaway(ctx, id, tx);
    if (g.status !== 'ENDED') throw invalidState(T.giveawayOnlyEndedReroll());
    const [draws, entries] = await Promise.all([
      tx.giveawayDraw.findMany({ where: { giveawayId: id }, orderBy: { seq: 'asc' } }),
      tx.giveawayEntry.findMany({
        where: { giveawayId: id },
        orderBy: { userId: 'asc' },
        select: { userId: true },
      }),
    ]);
    const previousWinners = draws.flatMap((d) => d.winnerIds);
    const result = drawWinners(
      entries.map((e) => e.userId),
      input.count ?? 1,
      previousWinners,
    );
    if (result.winnerIds.length === 0) throw conflict(T.giveawayNoRemainingEntrants());
    const seq = (draws[draws.length - 1]?.seq ?? 0) + 1;
    const reason = cleanText(input.reason);
    const draw = await tx.giveawayDraw.create({
      data: {
        giveawayId: id,
        seq,
        kind: 'REROLL',
        winnerIds: result.winnerIds,
        entrantCount: result.entrantCount,
        entrantsHash: result.entrantsHash,
        algorithm: result.algorithm,
        reason,
        drawnById: ctx.actor.userId,
      },
    });
    await audit(
      ctx,
      {
        action: 'engagement.giveaway.reroll',
        targetType: 'Giveaway',
        targetId: id,
        metadata: {
          seq,
          reason,
          excluded: previousWinners.length,
          winners: result.winnerIds.length,
          entrantsHash: result.entrantsHash,
        },
      },
      tx,
    );
    await enqueueJob(tx, {
      type: JOBS.giveawayAnnounce,
      dedupeKey: `${JOBS.giveawayAnnounce}:${draw.id}`,
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { drawId: draw.id },
    });
    return draw;
  });
}

export async function cancelGiveaway(ctx: Ctx, id: string, reason?: string): Promise<Giveaway> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'giveaways.manage', 'engagement.giveaway.cancel');
  const why = z.string().trim().max(500).optional().parse(reason);
  await loadGiveaway(ctx, id);
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.giveaway.updateMany({
      where: { id, guildId: ctx.guildId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
      data: { status: 'CANCELLED', endedAt: ctx.now() },
    });
    if (res.count === 0) throw invalidState(T.giveawayOnlyActiveCancel());
    await cancelJob(tx, endKey(id));
    await audit(
      ctx,
      {
        action: 'engagement.giveaway.cancel',
        targetType: 'Giveaway',
        targetId: id,
        metadata: { reason: why ? cleanText(why) : undefined },
      },
      tx,
    );
    await enqueueGiveawayRefresh(ctx, tx, id, true);
    return tx.giveaway.findUniqueOrThrow({ where: { id } });
  });
}

// ─── Member operations ──────────────────────────────────────────────────────

/** Enter a giveaway. Eligibility is checked at entry time with member data supplied by the bot. */
export async function enterGiveaway(
  ctx: Ctx,
  id: string,
  member: MemberEligibilityInfo,
): Promise<{ entrantCount: number }> {
  await requireModule(ctx, 'engagement');
  await requireRate(ctx, 'engagement.giveaway.enter', 10, 60);
  const g = await loadGiveaway(ctx, id);
  if (g.status !== 'ACTIVE' || g.endsAt.getTime() <= ctx.now().getTime())
    throw invalidState(T.giveawayNotAccepting());
  const check = checkGiveawayEligibility(g, member, ctx.now());
  if (!check.eligible)
    throw invalidState(T.giveawayNotEligible({ reasons: check.reasons.map((r) => `• ${r}`).join('\n') }));
  try {
    await ctx.db.$transaction(async (tx) => {
      await lockRow(tx, 'Giveaway', id, 'share'); // blocks a concurrent end until the entry commits
      const cur = await tx.giveaway.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (cur.status !== 'ACTIVE') throw invalidState(T.giveawayNotAccepting());
      await tx.giveawayEntry.create({ data: { giveawayId: id, userId: ctx.actor.userId } });
      await enqueueGiveawayRefresh(ctx, tx, id);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(T.giveawayAlreadyEntered());
    throw e;
  }
  return { entrantCount: await ctx.db.giveawayEntry.count({ where: { giveawayId: id } }) };
}

export async function leaveGiveaway(ctx: Ctx, id: string): Promise<{ left: boolean }> {
  await requireModule(ctx, 'engagement');
  await requireRate(ctx, 'engagement.giveaway.enter', 10, 60);
  const g = await loadGiveaway(ctx, id);
  if (g.status !== 'ACTIVE') throw invalidState(T.giveawayEntriesLocked());
  return ctx.db.$transaction(async (tx) => {
    await lockRow(tx, 'Giveaway', id, 'share');
    const cur = await tx.giveaway.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (cur.status !== 'ACTIVE') throw invalidState(T.giveawayEntriesLocked());
    const res = await tx.giveawayEntry.deleteMany({ where: { giveawayId: id, userId: ctx.actor.userId } });
    if (res.count > 0) await enqueueGiveawayRefresh(ctx, tx, id);
    return { left: res.count > 0 };
  });
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export const listGiveawaysSchema = paginationSchema.extend({
  status: z.enum(['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED']).optional(),
});

export type GiveawaySummary = Giveaway & { entrantCount: number };

/** Public listing (prize details are public); entrant identities are not included. */
export async function listGiveaways(
  ctx: Ctx,
  raw: z.input<typeof listGiveawaysSchema> = {},
): Promise<Page<GiveawaySummary>> {
  await requireModule(ctx, 'engagement');
  const f = listGiveawaysSchema.parse(raw);
  const where: Prisma.GiveawayWhereInput = { guildId: ctx.guildId, status: f.status };
  const rows = await ctx.db.giveaway.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { _count: { select: { entries: true } } },
    ...cursorArgs(f),
  });
  const page = toPage(rows, f.limit);
  return { ...page, items: page.items.map(({ _count, ...g }) => ({ ...g, entrantCount: _count.entries })) };
}

export interface DrawAudit extends GiveawayDraw {
  verification: DrawVerification;
}

/** Staff/dashboard: giveaway with all draws, each independently re-verified against the stored entries. */
export async function getGiveawayAudit(
  ctx: Ctx,
  id: string,
): Promise<{ giveaway: Giveaway; entrantCount: number; draws: DrawAudit[] }> {
  await requirePermission(ctx, 'giveaways.manage', 'engagement.giveaway.audit');
  const giveaway = await loadGiveaway(ctx, id);
  const [draws, entries] = await Promise.all([
    ctx.db.giveawayDraw.findMany({ where: { giveawayId: id }, orderBy: { seq: 'asc' } }),
    ctx.db.giveawayEntry.findMany({ where: { giveawayId: id }, select: { userId: true } }),
  ]);
  const all = entries.map((e) => e.userId);
  const excluded: string[] = [];
  const audited = draws.map((d) => {
    const pool = all.filter((u) => !excluded.includes(u));
    excluded.push(...d.winnerIds);
    return { ...d, verification: verifyDraw(d, pool) };
  });
  return { giveaway, entrantCount: all.length, draws: audited };
}
