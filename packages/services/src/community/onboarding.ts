import { z } from 'zod';
import type { Db, OnboardingRecord, WelcomeConfig } from '@gynx/database';
import { forbidden, validation } from '@gynx/shared';
import { audit } from '../core/audit';
import { requireRate } from '../core/authz';
import { getGuildConfig, isModuleEnabled, requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { enqueueJob } from '../core/jobs';
import { detectRaid, isNewAccount, raidAlertDedupeKey, raidBucket, type RaidDetection } from './raid';
import type { RoleMeta } from './role-safety';
import { snowflakeSchema } from './schemas';
import { assertRoleAssignable, type RoleChange } from './self-roles';
import { CommunityText as T } from './texts';
import { loadWelcomeConfig } from './welcome';

export const RAID_ALERT_JOB = 'community.raid-alert';

/** Live member facts supplied by the gateway (never by the member). */
export interface MemberFacts {
  joinedAt?: Date | null;
  accountCreatedAt?: Date | null;
}

export const recordJoinSchema = z.object({
  userId: snowflakeSchema,
  joinedAt: z.coerce.date(),
  accountCreatedAt: z.coerce.date(),
  memberCount: z.number().int().min(0).optional(),
});

export interface JoinResult {
  record: OnboardingRecord;
  welcome: WelcomeConfig;
  moduleEnabled: boolean;
  isNewAccount: boolean;
  raid: RaidDetection;
  /** True when this member must pass the verification button. */
  requiresVerification: boolean;
}

/** Verification is required when enabled, during a REQUIRE_VERIFICATION raid, or for accounts younger than the minimum age. */
export function verificationRequired(
  welcome: WelcomeConfig,
  record: Pick<OnboardingRecord, 'raidFlagged' | 'accountCreatedAt'>,
  now: Date,
): boolean {
  if (welcome.verificationEnabled) return true;
  if (record.raidFlagged && welcome.raidAction === 'REQUIRE_VERIFICATION') return true;
  return isNewAccount(record.accountCreatedAt, now, welcome.minAccountAgeDays);
}

const MAX_WINDOW_SAMPLE = 5000;

/**
 * Record a member join (gateway listener, system actor). Join events are always
 * recorded for growth analytics; raid detection only runs when the community
 * module is enabled. Never kicks or bans: a detected raid flags the joiners,
 * enqueues one staff alert per window bucket and (optionally) requires verification.
 */
export async function recordJoin(ctx: Ctx, raw: z.input<typeof recordJoinSchema>): Promise<JoinResult> {
  const input = recordJoinSchema.parse(raw);
  const now = ctx.now();
  const welcome = await loadWelcomeConfig(ctx.db, ctx.guildId);
  const moduleEnabled = await isModuleEnabled(ctx.db, ctx.guildId, 'community');

  let record = await ctx.db.$transaction(async (tx) => {
    const rec = await tx.onboardingRecord.upsert({
      where: { guildId_userId: { guildId: ctx.guildId, userId: input.userId } },
      create: {
        guildId: ctx.guildId,
        userId: input.userId,
        joinedAt: input.joinedAt,
        accountCreatedAt: input.accountCreatedAt,
      },
      // Rejoining: Discord dropped their roles, so verification starts over (rules acceptance is kept).
      update: {
        joinedAt: input.joinedAt,
        accountCreatedAt: input.accountCreatedAt,
        leftAt: null,
        verifiedAt: null,
        raidFlagged: false,
      },
    });
    // Clamp to now so clock skew can't push a join outside the raid window.
    const at = input.joinedAt > now ? now : input.joinedAt;
    await tx.memberEvent.create({ data: { guildId: ctx.guildId, userId: input.userId, type: 'JOIN', at } });
    if (input.memberCount !== undefined) {
      await tx.guild.update({
        where: { id: ctx.guildId },
        data: { memberCount: input.memberCount, memberCountAt: now },
      });
    }
    return rec;
  });

  let raid: RaidDetection = {
    isRaid: false,
    joinsInWindow: 0,
    windowStart: new Date(now.getTime() - welcome.raidWindowSeconds * 1000),
  };
  if (moduleEnabled) {
    raid = await evaluateRaid(ctx, welcome, now);
    if (raid.isRaid)
      record = (await ctx.db.onboardingRecord.findUnique({ where: { id: record.id } })) ?? record;
  }

  return {
    record,
    welcome,
    moduleEnabled,
    isNewAccount: isNewAccount(input.accountCreatedAt, now, welcome.minAccountAgeDays),
    raid,
    requiresVerification: moduleEnabled && verificationRequired(welcome, record, now),
  };
}

async function evaluateRaid(ctx: Ctx, welcome: WelcomeConfig, now: Date): Promise<RaidDetection> {
  const since = new Date(now.getTime() - welcome.raidWindowSeconds * 1000);
  const joins = await ctx.db.memberEvent.findMany({
    where: { guildId: ctx.guildId, type: 'JOIN', at: { gt: since, lte: now } },
    select: { at: true },
    take: MAX_WINDOW_SAMPLE,
  });
  const raid = detectRaid(
    joins.map((j) => j.at),
    now,
    welcome.raidJoinThreshold,
    welcome.raidWindowSeconds,
  );
  if (!raid.isRaid) return raid;

  const bucket = raidBucket(now, welcome.raidWindowSeconds);
  const dedupeKey = raidAlertDedupeKey(ctx.guildId, bucket);
  await ctx.db.$transaction(async (tx) => {
    await tx.onboardingRecord.updateMany({
      where: { guildId: ctx.guildId, joinedAt: { gt: raid.windowStart }, leftAt: null, raidFlagged: false },
      data: { raidFlagged: true },
    });
    const existing = await tx.scheduledJob.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (existing) return;
    await enqueueJob(tx, {
      type: RAID_ALERT_JOB,
      dedupeKey,
      runAt: now,
      guildId: ctx.guildId,
      payload: {
        detectedAt: now.toISOString(),
        windowStart: raid.windowStart.toISOString(),
        windowSeconds: welcome.raidWindowSeconds,
        threshold: welcome.raidJoinThreshold,
        joinsInWindow: raid.joinsInWindow,
        action: welcome.raidAction,
      },
    });
    await audit(
      ctx,
      {
        action: 'community.raid.detected',
        targetType: 'Guild',
        targetId: ctx.guildId,
        metadata: {
          joinsInWindow: raid.joinsInWindow,
          windowSeconds: welcome.raidWindowSeconds,
          action: welcome.raidAction,
        },
      },
      tx,
    );
  });
  return raid;
}

export const recordLeaveSchema = z.object({
  userId: snowflakeSchema,
  memberCount: z.number().int().min(0).optional(),
});

/** Record a member leaving (gateway listener). */
export async function recordLeave(ctx: Ctx, raw: z.input<typeof recordLeaveSchema>): Promise<void> {
  const input = recordLeaveSchema.parse(raw);
  const now = ctx.now();
  await getGuildConfig(ctx.db, ctx.guildId);
  await ctx.db.$transaction(async (tx) => {
    await tx.onboardingRecord.updateMany({
      where: { guildId: ctx.guildId, userId: input.userId, leftAt: null },
      data: { leftAt: now },
    });
    await tx.memberEvent.create({
      data: { guildId: ctx.guildId, userId: input.userId, type: 'LEAVE', at: now },
    });
    if (input.memberCount !== undefined) {
      await tx.guild.update({
        where: { id: ctx.guildId },
        data: { memberCount: input.memberCount, memberCountAt: now },
      });
    }
  });
}

/** Get (or lazily create, for members who joined before the bot) the acting member's record. */
async function ensureOwnRecord(ctx: Ctx, facts: MemberFacts): Promise<OnboardingRecord> {
  if (ctx.actor.isSystem) throw forbidden('Onboarding actions must be performed by the member.');
  const now = ctx.now();
  return ctx.db.onboardingRecord.upsert({
    where: { guildId_userId: { guildId: ctx.guildId, userId: ctx.actor.userId } },
    create: {
      guildId: ctx.guildId,
      userId: ctx.actor.userId,
      joinedAt: facts.joinedAt ?? now,
      accountCreatedAt: facts.accountCreatedAt ?? facts.joinedAt ?? now,
    },
    update: {},
  });
}

export interface OnboardingStatus {
  welcome: WelcomeConfig;
  rulesAccepted: boolean;
  verified: boolean;
  requiresVerification: boolean;
  interests: string[];
}

export async function getOnboardingStatus(ctx: Ctx, facts: MemberFacts = {}): Promise<OnboardingStatus> {
  await requireModule(ctx, 'community');
  const welcome = await loadWelcomeConfig(ctx.db, ctx.guildId);
  const rec = await ensureOwnRecord(ctx, facts);
  return {
    welcome,
    rulesAccepted: rec.rulesAcceptedAt !== null,
    verified: rec.verifiedAt !== null,
    requiresVerification: verificationRequired(welcome, rec, ctx.now()),
    interests: rec.interests,
  };
}

/** Member accepts the rules. Idempotent. */
export async function acceptRules(
  ctx: Ctx,
  facts: MemberFacts = {},
): Promise<{ alreadyAccepted: boolean; status: OnboardingStatus }> {
  await requireModule(ctx, 'community');
  await requireRate(ctx, 'community.rules.accept', 5, 60);
  const rec = await ensureOwnRecord(ctx, facts);
  const alreadyAccepted = rec.rulesAcceptedAt !== null;
  if (!alreadyAccepted) {
    await ctx.db.$transaction(async (tx) => {
      await tx.onboardingRecord.update({ where: { id: rec.id }, data: { rulesAcceptedAt: ctx.now() } });
      await audit(
        ctx,
        { action: 'community.onboarding.rules_accept', targetType: 'User', targetId: ctx.actor.userId },
        tx,
      );
    });
  }
  return { alreadyAccepted, status: await getOnboardingStatus(ctx, facts) };
}

/**
 * Member passes the verification button. The verification prompt shows the
 * rules, so clicking it also records rules acceptance. Returns the role the
 * bot should apply (null when no verified role is configured).
 */
export async function completeVerification(
  ctx: Ctx,
  facts: MemberFacts = {},
): Promise<{ verifiedRoleId: string | null; alreadyVerified: boolean }> {
  await requireModule(ctx, 'community');
  await requireRate(ctx, 'community.verify', 5, 60);
  const welcome = await loadWelcomeConfig(ctx.db, ctx.guildId);
  const rec = await ensureOwnRecord(ctx, facts);
  const alreadyVerified = rec.verifiedAt !== null;
  if (!alreadyVerified) {
    const now = ctx.now();
    await ctx.db.$transaction(async (tx) => {
      await tx.onboardingRecord.update({
        where: { id: rec.id },
        data: { verifiedAt: now, rulesAcceptedAt: rec.rulesAcceptedAt ?? now },
      });
      await audit(
        ctx,
        {
          action: 'community.onboarding.verify',
          targetType: 'User',
          targetId: ctx.actor.userId,
          metadata: { raidFlagged: rec.raidFlagged },
        },
        tx,
      );
    });
  }
  return { verifiedRoleId: welcome.verifiedRoleId, alreadyVerified };
}

export interface InterestSelection {
  interests: string[];
  add: RoleChange[];
  remove: RoleChange[];
}

/**
 * Member picks their games. Only enabled allowlisted roles of group `games` are
 * accepted; each added role is safety-checked against live role data. Unselected
 * game roles the member currently holds are removed (set semantics).
 */
export async function selectInterests(
  ctx: Ctx,
  selectedRoleIds: readonly string[],
  live: { roles: readonly RoleMeta[]; botHighestPosition: number },
  facts: MemberFacts = {},
): Promise<InterestSelection> {
  await requireModule(ctx, 'community');
  await requireRate(ctx, 'community.interests', 5, 60);
  const selected = [...new Set(z.array(snowflakeSchema).max(25).parse(selectedRoleIds))];
  const games = await ctx.db.selfAssignableRole.findMany({
    where: { guildId: ctx.guildId, group: 'games', enabled: true },
  });
  const allowed = new Map(games.map((g) => [g.roleId, g]));
  const invalid = selected.filter((id) => !allowed.has(id));
  if (invalid.length) throw forbidden(T.interestsInvalid());

  const metaById = new Map(live.roles.map((r) => [r.id, r]));
  const add: RoleChange[] = [];
  for (const id of selected) {
    if (ctx.actor.roleIds.includes(id)) continue;
    const role = metaById.get(id);
    if (!role) throw validation(T.roleGone());
    await assertRoleAssignable(ctx, id, { role, botHighestPosition: live.botHighestPosition }, 'forbidden');
    add.push({ roleId: id, label: allowed.get(id)!.label, action: 'add' });
  }
  const remove: RoleChange[] = games
    .filter((g) => !selected.includes(g.roleId) && ctx.actor.roleIds.includes(g.roleId))
    .map((g) => ({ roleId: g.roleId, label: g.label, action: 'remove' as const }));

  const rec = await ensureOwnRecord(ctx, facts);
  await ctx.db.onboardingRecord.update({ where: { id: rec.id }, data: { interests: selected } });
  return { interests: selected, add, remove };
}

/** Recent raid-flagged joiners (dashboard / staff). Returns IDs only. */
export async function countRaidFlaggedSince(db: Db, guildId: string, since: Date): Promise<number> {
  return db.onboardingRecord.count({ where: { guildId, raidFlagged: true, joinedAt: { gt: since } } });
}

/**
 * Retention: delete MemberEvents older than `activityRetentionDays` and the
 * onboarding records of members who left longer ago than that.
 */
export async function purgeCommunityData(
  db: Db,
  guildId: string,
  now: Date,
): Promise<{ memberEvents: number; onboardingRecords: number }> {
  const cfg = await getGuildConfig(db, guildId);
  const cutoff = new Date(now.getTime() - cfg.activityRetentionDays * 86_400_000);
  const [events, records] = await Promise.all([
    db.memberEvent.deleteMany({ where: { guildId, at: { lt: cutoff } } }),
    db.onboardingRecord.deleteMany({ where: { guildId, leftAt: { not: null, lt: cutoff } } }),
  ]);
  return { memberEvents: events.count, onboardingRecords: records.count };
}
