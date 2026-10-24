import { z } from 'zod';
import {
  isUniqueViolation,
  type AttributionConfidence,
  type Prisma,
  type ReferralAttribution,
  type ReferralInvite,
} from '@gynx/database';
import {
  AppError,
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
import { can, requireAny, requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { ABUSE_FLAG_LABELS, BURST_WINDOW_MS, detectReferralAbuse, snowflakeTimestamp } from './attribution';
import { snowflakeSchema } from './common';

// ─── Invites ────────────────────────────────────────────────────────────────

export const createReferralInviteSchema = z.object({
  /** Channel the Discord invite points to. */
  channelId: snowflakeSchema,
  campaign: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\w .-]+$/, 'Use letters, numbers, spaces, dots, dashes or underscores.')
    .optional(),
  partnerCampaignId: z.string().min(1).max(64).optional(),
  /** 0 = never expires (default). */
  maxAgeSeconds: z.number().int().min(0).max(604_800).default(0),
});
export type CreateReferralInviteInput = z.input<typeof createReferralInviteSchema>;

/**
 * Create (or return) a tracked Discord invite.
 *  - Any member gets ONE personal invite (returned again on repeat calls).
 *  - Campaign invites need `referrals.manage`; partner-campaign invites need
 *    `referrals.manage` or `partners.review`, and are owned by the partner.
 */
export async function createReferralInvite(
  ctx: Ctx,
  raw: CreateReferralInviteInput,
): Promise<{ invite: ReferralInvite; created: boolean }> {
  await requireModule(ctx, 'referrals');
  const input = createReferralInviteSchema.parse(raw);

  let ownerId = ctx.actor.userId;
  let campaign = input.campaign ?? null;
  if (input.partnerCampaignId) {
    await requireAny(ctx, ['referrals.manage', 'partners.review'], 'referrals.invite.create');
    const pc = await ctx.db.partnerCampaign.findFirst({
      where: { id: input.partnerCampaignId, guildId: ctx.guildId },
    });
    if (!pc) throw notFound('Partner campaign');
    if (!pc.active) throw invalidState('That partner campaign is not active.');
    ownerId = pc.partnerId;
    campaign = campaign ?? pc.name.slice(0, 64);
  } else if (campaign) {
    await requirePermission(ctx, 'referrals.manage', 'referrals.invite.create');
  } else {
    const existing = await ctx.db.referralInvite.findFirst({
      where: { guildId: ctx.guildId, ownerId, campaign: null, partnerCampaignId: null, active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { invite: existing, created: false };
  }

  await requireRate(ctx, 'referrals.invite', 5, 3600);
  if (!ctx.discord) throw new AppError('CONFIG', 'Discord is not available in this process.');
  const { code } = await ctx.discord.createInvite(input.channelId, {
    maxAgeSeconds: input.maxAgeSeconds,
    maxUses: 0,
    reason: `Referral invite for ${ownerId}${campaign ? ` (${campaign})` : ''}`,
  });

  try {
    return await ctx.db.$transaction(async (tx) => {
      const invite = await tx.referralInvite.create({
        data: {
          guildId: ctx.guildId,
          code,
          ownerId,
          campaign,
          partnerCampaignId: input.partnerCampaignId ?? null,
          createdById: ctx.actor.userId,
        },
      });
      await audit(
        ctx,
        {
          action: 'referrals.invite.create',
          targetType: 'ReferralInvite',
          targetId: invite.id,
          metadata: { ownerId, campaign, partnerCampaignId: invite.partnerCampaignId },
        },
        tx,
      );
      return { invite, created: true };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('That invite is already registered.');
    throw e;
  }
}

export async function listMyReferralInvites(ctx: Ctx): Promise<ReferralInvite[]> {
  await requireModule(ctx, 'referrals');
  return ctx.db.referralInvite.findMany({
    where: { guildId: ctx.guildId, ownerId: ctx.actor.userId },
    orderBy: { createdAt: 'desc' },
  });
}

export const listInvitesSchema = paginationSchema.extend({
  ownerId: snowflakeSchema.optional(),
  campaign: z.string().trim().max(64).optional(),
  partnerCampaignId: z.string().max(64).optional(),
});

export async function listReferralInvites(
  ctx: Ctx,
  raw: z.input<typeof listInvitesSchema> = {},
): Promise<Page<ReferralInvite>> {
  await requireAny(ctx, ['referrals.view', 'referrals.manage']);
  const f = listInvitesSchema.parse(raw);
  const rows = await ctx.db.referralInvite.findMany({
    where: {
      guildId: ctx.guildId,
      ownerId: f.ownerId,
      campaign: f.campaign,
      partnerCampaignId: f.partnerCampaignId,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}

/** Stop crediting an invite (owner or `referrals.manage`). The Discord invite itself is left for staff to revoke. */
export async function deactivateReferralInvite(ctx: Ctx, id: string): Promise<ReferralInvite> {
  const inv = await ctx.db.referralInvite.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!inv) throw notFound('Invite');
  if (inv.ownerId !== ctx.actor.userId)
    await requirePermission(ctx, 'referrals.manage', 'referrals.invite.deactivate');
  return ctx.db.$transaction(async (tx) => {
    const r = await tx.referralInvite.update({ where: { id }, data: { active: false } });
    await audit(
      ctx,
      { action: 'referrals.invite.deactivate', targetType: 'ReferralInvite', targetId: id },
      tx,
    );
    return r;
  });
}

/** Codes of active tracked invites (bot uses this to label its invite cache). */
export async function trackedInviteCodes(db: Ctx['db'], guildId: string): Promise<Set<string>> {
  const rows = await db.referralInvite.findMany({ where: { guildId, active: true }, select: { code: true } });
  return new Set(rows.map((r) => r.code));
}

// ─── Attribution ────────────────────────────────────────────────────────────

export const recordAttributionSchema = z.object({
  joinedUserId: snowflakeSchema,
  confidence: z.enum(['CONFIRMED', 'AMBIGUOUS', 'UNKNOWN']),
  /** The single invite whose uses increased (CONFIRMED only). */
  inviteCode: z.string().min(1).max(64).nullable().optional(),
  /** Use-count observed for that invite after the join. */
  inviteUses: z.number().int().min(0).optional(),
  joinedAt: z.date().optional(),
  /** Defaults to the creation time encoded in the user's snowflake. */
  accountCreatedAt: z.date().optional(),
});
export type RecordAttributionInput = z.input<typeof recordAttributionSchema>;

/**
 * Store a join attribution from the bot's invite diff. Never fabricates: a
 * referrer is credited only for CONFIRMED joins via an active tracked invite.
 * Suspicious credited joins are FLAGGED and excluded from leaderboards until staff review them.
 */
export async function recordAttribution(ctx: Ctx, raw: RecordAttributionInput): Promise<ReferralAttribution> {
  if (!ctx.actor.isSystem) await requirePermission(ctx, 'referrals.manage', 'referrals.attribution.record');
  await requireModule(ctx, 'referrals');
  const input = recordAttributionSchema.parse(raw);
  const joinedAt = input.joinedAt ?? ctx.now();
  let confidence: AttributionConfidence = input.confidence;
  const inviteCode = confidence === 'CONFIRMED' ? (input.inviteCode ?? null) : null;
  if (confidence === 'CONFIRMED' && !inviteCode) confidence = 'UNKNOWN';

  const invite = inviteCode
    ? await ctx.db.referralInvite.findFirst({
        where: { guildId: ctx.guildId, code: inviteCode, active: true },
      })
    : null;
  // A single changed invite that we don't track (or that was deactivated) credits nobody.
  if (confidence === 'CONFIRMED' && !invite) confidence = 'UNKNOWN';
  const referrerId = confidence === 'CONFIRMED' ? (invite?.ownerId ?? null) : null;

  let flags: string[] = [];
  if (referrerId && inviteCode) {
    const [previous, recent] = await Promise.all([
      ctx.db.referralAttribution.count({ where: { guildId: ctx.guildId, joinedUserId: input.joinedUserId } }),
      ctx.db.referralAttribution.count({
        where: {
          guildId: ctx.guildId,
          inviteCode,
          joinedAt: { gte: new Date(joinedAt.getTime() - BURST_WINDOW_MS), lte: joinedAt },
        },
      }),
    ]);
    flags = detectReferralAbuse({
      referrerId,
      joinedUserId: input.joinedUserId,
      accountCreatedAt: input.accountCreatedAt ?? snowflakeTimestamp(input.joinedUserId),
      joinedAt,
      previouslyAttributed: previous > 0,
      recentJoinsViaInvite: recent,
    });
  }

  return ctx.db.$transaction(async (tx) => {
    const row = await tx.referralAttribution.create({
      data: {
        guildId: ctx.guildId,
        joinedUserId: input.joinedUserId,
        // Untracked single-invite joins keep the code for context, but credit nobody.
        inviteCode,
        referrerId,
        campaign: invite?.campaign ?? null,
        confidence,
        status: flags.length ? 'FLAGGED' : 'VALID',
        flagReason: flags.length
          ? flags.map((f) => ABUSE_FLAG_LABELS[f as keyof typeof ABUSE_FLAG_LABELS]).join('; ')
          : null,
        joinedAt,
      },
    });
    if (invite && input.inviteUses !== undefined) {
      await tx.referralInvite.update({ where: { id: invite.id }, data: { lastKnownUses: input.inviteUses } });
    }
    if (flags.length) {
      await audit(
        ctx,
        {
          action: 'referrals.attribution.flagged',
          targetType: 'ReferralAttribution',
          targetId: row.id,
          result: 'FAILURE',
          metadata: { flags, referrerId },
        },
        tx,
      );
    }
    return row;
  });
}

export const reviewAttributionSchema = z.object({
  status: z.enum(['VALID', 'INVALID', 'DISPUTED']),
  note: z.string().trim().min(3).max(500),
});

/** Staff resolution of flagged / disputed attributions. */
export async function reviewAttribution(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof reviewAttributionSchema>,
): Promise<ReferralAttribution> {
  await requirePermission(ctx, 'referrals.manage', 'referrals.attribution.review');
  const input = reviewAttributionSchema.parse(raw);
  const row = await ctx.db.referralAttribution.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!row) throw notFound('Referral');
  if (input.status === 'VALID' && (row.confidence !== 'CONFIRMED' || !row.referrerId)) {
    throw invalidState('Only confirmed attributions with a referrer can be marked valid.');
  }
  if (row.referrerId && row.referrerId === ctx.actor.userId)
    throw forbidden('You cannot review your own referrals.');
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.referralAttribution.update({
      where: { id },
      data: {
        status: input.status,
        reviewNote: redactSecrets(input.note, { maskIps: false }),
        reviewedById: ctx.actor.userId,
      },
    });
    await audit(
      ctx,
      {
        action: 'referrals.attribution.review',
        targetType: 'ReferralAttribution',
        targetId: id,
        metadata: { from: row.status, to: input.status },
      },
      tx,
    );
    return updated;
  });
}

export const listAttributionsSchema = paginationSchema.extend({
  status: z.enum(['VALID', 'FLAGGED', 'DISPUTED', 'INVALID']).optional(),
  confidence: z.enum(['CONFIRMED', 'AMBIGUOUS', 'UNKNOWN']).optional(),
  referrerId: snowflakeSchema.optional(),
  campaign: z.string().trim().max(64).optional(),
});

export async function listAttributions(
  ctx: Ctx,
  raw: z.input<typeof listAttributionsSchema> = {},
): Promise<Page<ReferralAttribution>> {
  await requireAny(ctx, ['referrals.view', 'referrals.manage']);
  const f = listAttributionsSchema.parse(raw);
  const rows = await ctx.db.referralAttribution.findMany({
    where: {
      guildId: ctx.guildId,
      status: f.status,
      confidence: f.confidence,
      referrerId: f.referrerId,
      campaign: f.campaign,
    },
    orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  const page = toPage(rows, f.limit);
  // Review notes are for referral managers only.
  return can(ctx, 'referrals.manage')
    ? page
    : { ...page, items: page.items.map((r) => ({ ...r, reviewNote: null })) };
}

// ─── Leaderboard & stats ────────────────────────────────────────────────────

export const LEADERBOARD_PERIODS = ['7', '30', 'all'] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

const sinceFor = (period: LeaderboardPeriod, now: Date): Date | undefined =>
  period === 'all' ? undefined : new Date(now.getTime() - Number(period) * 86_400_000);

/** Counted referrals = CONFIRMED + VALID only. Flagged/disputed/invalid never count. */
export const countedReferralWhere = (
  guildId: string,
  since?: Date,
): Prisma.ReferralAttributionWhereInput => ({
  guildId,
  status: 'VALID',
  confidence: 'CONFIRMED',
  referrerId: { not: null },
  ...(since ? { joinedAt: { gte: since } } : {}),
});

export async function referralLeaderboard(
  ctx: Ctx,
  period: LeaderboardPeriod = '30',
): Promise<Array<{ rank: number; referrerId: string; referrals: number }>> {
  await requireModule(ctx, 'referrals');
  const p = z.enum(LEADERBOARD_PERIODS).parse(period);
  const rows = await ctx.db.referralAttribution.groupBy({
    by: ['referrerId'],
    where: countedReferralWhere(ctx.guildId, sinceFor(p, ctx.now())),
    _count: { _all: true },
    orderBy: [{ _count: { referrerId: 'desc' } }, { referrerId: 'asc' }],
    take: 10,
  });
  return rows.map((r, i) => ({ rank: i + 1, referrerId: r.referrerId!, referrals: r._count._all }));
}

/** The calling member's own referral counts. */
export async function myReferralStats(ctx: Ctx) {
  await requireModule(ctx, 'referrals');
  const base = { guildId: ctx.guildId, referrerId: ctx.actor.userId, confidence: 'CONFIRMED' as const };
  const [byStatus, invites, last30] = await Promise.all([
    ctx.db.referralAttribution.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ctx.db.referralInvite.findMany({
      where: { guildId: ctx.guildId, ownerId: ctx.actor.userId, active: true },
      select: { code: true, campaign: true },
    }),
    ctx.db.referralAttribution.count({
      where: {
        ...countedReferralWhere(ctx.guildId, sinceFor('30', ctx.now())),
        referrerId: ctx.actor.userId,
      },
    }),
  ]);
  const n = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  return {
    valid: n('VALID'),
    underReview: n('FLAGGED') + n('DISPUTED'),
    invalid: n('INVALID'),
    validLast30Days: last30,
    invites,
  };
}
