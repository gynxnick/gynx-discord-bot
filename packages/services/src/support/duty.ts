import { z } from 'zod';
import { type Prisma, type Db, type DutyEndReason, type DutyProfile } from '@gynx/database';
import { AppError, conflict, discordTimestamp, invalidState, validation } from '@gynx/shared';
import { audit } from '../core/audit';
import { requirePermission } from '../core/authz';
import { getGuildConfig, requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { enqueueJob } from '../core/jobs';
import { SupportText as T } from './texts';

/**
 * Support duty: staff go on/off duty; the public support status panel shows who
 * is available. Strictly availability: no ticket creation or management here
 * (tickets live in the GYNX web ticketer).
 *
 * - Only staff with an admin-approved public name (DutyProfile) can go on duty,
 *   and customers only ever see that name.
 * - One open session per person (advisory lock), automatic expiry after
 *   GuildConfig.dutyMaxHours, ended when they leave the server or lose their name.
 */

export const SYNC_JOB = 'support.panel.sync';

export interface OnDutyEntry {
  userId: string;
  publicName: string;
  startedAt: Date;
  expiresAt: Date;
}

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Approved names can't ping, link, format or impersonate an ID. */
export function cleanPublicName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  const bad =
    name.length < 1 ||
    name.length > 32 ||
    /[@<>#`*_~|\\[\]()]/.test(name) ||
    /https?:|www\.|discord\.gg/i.test(name) ||
    /^\d{6,}$/.test(name);
  if (bad) throw validation(T.publicNameInvalid(), { field: 'publicName' });
  return name;
}

const openSessionWhere = (guildId: string, now: Date, userId?: string): Prisma.DutySessionWhereInput => ({
  guildId,
  endedAt: null,
  expiresAt: { gt: now },
  ...(userId ? { userId } : {}),
});

/** Ask the worker to re-render the public panel now. */
export async function requestPanelSync(db: Db, guildId: string, now: Date) {
  await enqueueJob(db, {
    type: SYNC_JOB,
    dedupeKey: `${SYNC_JOB}:${guildId}:${now.getTime()}`,
    runAt: now,
    guildId,
  });
}

async function markChanged(db: Db, guildId: string, now: Date) {
  await db.guildConfig.update({ where: { guildId }, data: { supportStatusChangedAt: now } });
  await requestPanelSync(db, guildId, now);
}

/** Serialise duty changes per staff member (prevents two open sessions from a double click). */
const lockMember = (tx: Prisma.TransactionClient, guildId: string, userId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`duty:${guildId}:${userId}`}))`;

// ── Who is on duty ───────────────────────────────────────────────────────────

export async function listOnDuty(db: Db, guildId: string, now: Date): Promise<OnDutyEntry[]> {
  const sessions = await db.dutySession.findMany({
    where: openSessionWhere(guildId, now),
    orderBy: { startedAt: 'asc' },
  });
  if (!sessions.length) return [];
  const profiles = await db.dutyProfile.findMany({
    where: { guildId, userId: { in: sessions.map((s) => s.userId) }, enabled: true },
  });
  const names = new Map(profiles.map((p) => [p.userId, p.publicName]));
  return sessions.flatMap((s) => {
    const publicName = names.get(s.userId);
    // No approved name → never shown (the session is ended by the profile change itself).
    return publicName
      ? [{ userId: s.userId, publicName, startedAt: s.startedAt, expiresAt: s.expiresAt }]
      : [];
  });
}

// ── Staff: on / off ──────────────────────────────────────────────────────────

export async function startDuty(ctx: Ctx): Promise<{ publicName: string; hours: number; expiresAt: Date }> {
  await requireModule(ctx, 'support');
  await requirePermission(ctx, 'support.duty', 'support.duty.start');
  const now = ctx.now();
  const cfg = await getGuildConfig(ctx.db, ctx.guildId);
  const profile = await ctx.db.dutyProfile.findUnique({
    where: { guildId_userId: { guildId: ctx.guildId, userId: ctx.actor.userId } },
  });
  if (!profile || !profile.enabled) throw validation(T.dutyNoProfile());

  const hours = cfg.dutyMaxHours;
  const expiresAt = new Date(now.getTime() + hours * 3_600_000);
  await ctx.db.$transaction(async (tx) => {
    await lockMember(tx, ctx.guildId, ctx.actor.userId);
    const open = await tx.dutySession.findFirst({
      where: openSessionWhere(ctx.guildId, now, ctx.actor.userId),
    });
    if (open) throw conflict(T.dutyAlreadyOn({ since: discordTimestamp(open.startedAt, 'R') }));
    await tx.dutySession.create({
      data: { guildId: ctx.guildId, userId: ctx.actor.userId, startedAt: now, expiresAt },
    });
    await audit(ctx, { action: 'support.duty.start', targetType: 'User', targetId: ctx.actor.userId }, tx);
    await markChanged(tx, ctx.guildId, now);
  });
  return { publicName: profile.publicName, hours, expiresAt };
}

async function endOpenSession(
  db: Db,
  guildId: string,
  userId: string,
  now: Date,
  reason: DutyEndReason,
  endedById: string,
): Promise<boolean> {
  const r = await db.dutySession.updateMany({
    where: openSessionWhere(guildId, now, userId),
    data: { endedAt: now, endReason: reason, endedById },
  });
  return r.count > 0;
}

export async function endDuty(ctx: Ctx): Promise<void> {
  await requirePermission(ctx, 'support.duty', 'support.duty.end');
  const now = ctx.now();
  await ctx.db.$transaction(async (tx) => {
    await lockMember(tx, ctx.guildId, ctx.actor.userId);
    const ended = await endOpenSession(tx, ctx.guildId, ctx.actor.userId, now, 'MANUAL', ctx.actor.userId);
    if (!ended) throw invalidState(T.dutyNotOn());
    await audit(ctx, { action: 'support.duty.end', targetType: 'User', targetId: ctx.actor.userId }, tx);
    await markChanged(tx, ctx.guildId, now);
  });
}

/** A support lead ends someone else's session. Returns their public name. */
export async function endDutyFor(ctx: Ctx, rawUserId: string): Promise<string> {
  await requirePermission(ctx, 'support.duty.manage', 'support.duty.end_other');
  const userId = snowflake.parse(rawUserId);
  const now = ctx.now();
  const profile = await ctx.db.dutyProfile.findUnique({
    where: { guildId_userId: { guildId: ctx.guildId, userId } },
  });
  await ctx.db.$transaction(async (tx) => {
    await lockMember(tx, ctx.guildId, userId);
    const ended = await endOpenSession(tx, ctx.guildId, userId, now, 'ENDED_BY_ADMIN', ctx.actor.userId);
    if (!ended) throw invalidState(T.dutyNotOn());
    await audit(ctx, { action: 'support.duty.end_other', targetType: 'User', targetId: userId }, tx);
    await markChanged(tx, ctx.guildId, now);
  });
  return profile?.publicName ?? userId;
}

/** Gateway: a staff member left the server. */
export async function endDutyOnLeave(db: Db, guildId: string, userId: string, now: Date): Promise<boolean> {
  const ended = await endOpenSession(db, guildId, userId, now, 'LEFT_SERVER', 'system');
  if (ended) await markChanged(db, guildId, now);
  return ended;
}

/** Worker: close sessions past their expiry. Returns how many ended. */
export async function expireDutySessions(db: Db, guildId: string, now: Date): Promise<number> {
  const r = await db.dutySession.updateMany({
    where: { guildId, endedAt: null, expiresAt: { lte: now } },
    data: { endedAt: now, endReason: 'EXPIRED', endedById: 'system' },
  });
  if (r.count > 0) await markChanged(db, guildId, now);
  return r.count;
}

// ── Approved public names ────────────────────────────────────────────────────

export const dutyProfileSchema = z.object({
  userId: snowflake,
  publicName: z.string().max(64),
  enabled: z.boolean().default(true),
});

export async function listDutyProfiles(ctx: Ctx): Promise<DutyProfile[]> {
  await requirePermission(ctx, 'support.duty.manage');
  return ctx.db.dutyProfile.findMany({ where: { guildId: ctx.guildId }, orderBy: { publicName: 'asc' } });
}

export async function setDutyProfile(ctx: Ctx, raw: z.input<typeof dutyProfileSchema>): Promise<DutyProfile> {
  await requirePermission(ctx, 'support.duty.manage', 'support.duty.profile');
  const input = dutyProfileSchema.parse(raw);
  const publicName = cleanPublicName(input.publicName);
  const now = ctx.now();
  return ctx.db.$transaction(async (tx) => {
    const profile = await tx.dutyProfile.upsert({
      where: { guildId_userId: { guildId: ctx.guildId, userId: input.userId } },
      create: {
        guildId: ctx.guildId,
        userId: input.userId,
        publicName,
        enabled: input.enabled,
        approvedById: ctx.actor.userId,
      },
      update: { publicName, enabled: input.enabled, approvedById: ctx.actor.userId },
    });
    if (!input.enabled)
      await endOpenSession(tx, ctx.guildId, input.userId, now, 'PROFILE_REMOVED', ctx.actor.userId);
    await audit(
      ctx,
      {
        action: 'support.duty.profile',
        targetType: 'User',
        targetId: input.userId,
        metadata: { enabled: input.enabled },
      },
      tx,
    );
    await markChanged(tx, ctx.guildId, now); // renames show immediately
    return profile;
  });
}

export async function removeDutyProfile(ctx: Ctx, rawUserId: string): Promise<void> {
  await requirePermission(ctx, 'support.duty.manage', 'support.duty.profile_remove');
  const userId = snowflake.parse(rawUserId);
  const now = ctx.now();
  const existing = await ctx.db.dutyProfile.findUnique({
    where: { guildId_userId: { guildId: ctx.guildId, userId } },
  });
  if (!existing) throw new AppError('NOT_FOUND', T.profileNotFound());
  await ctx.db.$transaction(async (tx) => {
    await endOpenSession(tx, ctx.guildId, userId, now, 'PROFILE_REMOVED', ctx.actor.userId);
    await tx.dutyProfile.delete({ where: { guildId_userId: { guildId: ctx.guildId, userId } } });
    await audit(ctx, { action: 'support.duty.profile_remove', targetType: 'User', targetId: userId }, tx);
    await markChanged(tx, ctx.guildId, now);
  });
}
