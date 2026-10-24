import { z } from 'zod';
import { isUniqueViolation, type Announcement, type AnnouncementStatus, type Db } from '@gynx/database';
import {
  AppError,
  conflict,
  cursorArgs,
  invalidState,
  notFound,
  paginationSchema,
  toPage,
  validation,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requireAny, requirePermission } from '../core/authz';
import { getGuildConfig, requireModule } from '../core/config';
import { makeCtx, systemActor, type Ctx, type ServiceDeps } from '../core/context';
import type { DiscordPort, MessageBody } from '../core/discord-port';
import { cancelJob, enqueueJob } from '../core/jobs';
import {
  ANNOUNCEMENT_TYPES,
  MENTION_MODES,
  mentionWarning,
  parseScheduleInput,
  renderAnnouncement,
} from './announcement-render';
import { hexColor, publicHttpsUrl, snowflakeSchema } from './common';

export const ANNOUNCEMENT_PUBLISH_JOB = 'marketing.announcement.publish';
export const announcementJobKey = (id: string, version: number) => `announcement:${id}:v${version}`;
export const deliveryKey = (id: string, version: number) => `${id}:${version}`;

const MAX_SCHEDULE_AHEAD_MS = 366 * 86_400_000;

// ─── Templates ──────────────────────────────────────────────────────────────

export const DEFAULT_TEMPLATES: Array<{ name: string; type: (typeof ANNOUNCEMENT_TYPES)[number]; title: string; body: string }> = [
  { name: 'General update', type: 'GENERAL', title: 'Update from GYNX.GG', body: 'Hey everyone,\n\n[What is happening and why it matters]\n\n[Where to find more information]' },
  {
    name: 'Planned maintenance',
    type: 'MAINTENANCE',
    title: 'Planned maintenance: [service]',
    body: '**When:** [date and time, include time zone]\n**Expected duration:** [duration]\n**Affected:** [services or regions]\n\nYour servers and data are not affected beyond the window above. Follow the status channel for live updates.',
  },
  {
    name: 'Game launch',
    type: 'GAME_LAUNCH',
    title: 'Now available: [game] hosting',
    body: 'You can now host **[game]** servers on GYNX.GG.\n\n**Highlights**\n• [feature]\n• [feature]\n\n[Link to the game page]',
  },
  {
    name: 'Feature release',
    type: 'FEATURE_RELEASE',
    title: 'New: [feature name]',
    body: '**What is new:** [short description]\n**Why it helps:** [benefit]\n**How to use it:** [steps or link]',
  },
  { name: 'Milestone', type: 'MILESTONE', title: 'We reached [milestone]!', body: 'Thank you to everyone in the community for helping us reach **[milestone]**. [What comes next]' },
  {
    name: 'Review request',
    type: 'REVIEW_REQUEST',
    title: 'Enjoying GYNX.GG? Tell others!',
    body: 'If GYNX.GG has been good to you, an honest review really helps us grow: [review link]\n\nHad a problem instead? Let the support team know so we can fix it.',
  },
  { name: 'Community poll', type: 'POLL', title: 'We want your opinion', body: '[Question]\n\nVote in [poll link or channel] before [deadline].' },
  { name: 'Community event', type: 'EVENT', title: '[Event name]', body: '**When:** [date and time]\n**Where:** [channel or server]\n**What:** [description]\n\nRSVP in [event link].' },
  {
    name: 'Referral campaign',
    type: 'REFERRAL_CAMPAIGN',
    title: 'Invite your friends to the GYNX.GG community',
    body: 'Use `/referral create` to get your personal invite link and bring your friends to the community. Track your invites with `/referral stats`.',
  },
];

/** Create the default templates for a guild. Idempotent (unique on guild + name). */
export async function seedDefaultTemplates(db: Db, guildId: string): Promise<number> {
  const r = await db.announcementTemplate.createMany({
    data: DEFAULT_TEMPLATES.map((t) => ({ ...t, guildId })),
    skipDuplicates: true,
  });
  return r.count;
}

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  type: z.enum(ANNOUNCEMENT_TYPES),
  title: z.string().trim().min(1).max(256),
  body: z.string().trim().min(1).max(4000),
});

export async function listTemplates(ctx: Ctx) {
  await requireAny(ctx, ['announcements.create', 'announcements.publish']);
  await requireModule(ctx, 'announcements');
  await seedDefaultTemplates(ctx.db, ctx.guildId);
  return ctx.db.announcementTemplate.findMany({ where: { guildId: ctx.guildId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
}

export async function createTemplate(ctx: Ctx, raw: z.input<typeof templateSchema>) {
  await requirePermission(ctx, 'announcements.create');
  await requireModule(ctx, 'announcements');
  const input = templateSchema.parse(raw);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const t = await tx.announcementTemplate.create({ data: { ...input, guildId: ctx.guildId } });
      await audit(ctx, { action: 'announcements.template.create', targetType: 'AnnouncementTemplate', targetId: t.id, metadata: { name: t.name, type: t.type } }, tx);
      return t;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A template with that name already exists.');
    throw e;
  }
}

export async function updateTemplate(ctx: Ctx, id: string, raw: Partial<z.input<typeof templateSchema>>) {
  await requirePermission(ctx, 'announcements.create');
  const input = templateSchema.partial().parse(raw);
  const existing = await ctx.db.announcementTemplate.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!existing) throw notFound('Template');
  try {
    return await ctx.db.$transaction(async (tx) => {
      const t = await tx.announcementTemplate.update({ where: { id }, data: input });
      await audit(ctx, { action: 'announcements.template.update', targetType: 'AnnouncementTemplate', targetId: id, metadata: { fields: Object.keys(input) } }, tx);
      return t;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A template with that name already exists.');
    throw e;
  }
}

export async function deleteTemplate(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'announcements.create');
  const existing = await ctx.db.announcementTemplate.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!existing) throw notFound('Template');
  await ctx.db.$transaction(async (tx) => {
    await tx.announcementTemplate.delete({ where: { id } });
    await audit(ctx, { action: 'announcements.template.delete', targetType: 'AnnouncementTemplate', targetId: id, metadata: { name: existing.name } }, tx);
  });
}

// ─── Drafts ─────────────────────────────────────────────────────────────────

const announcementFields = z.object({
  type: z.enum(ANNOUNCEMENT_TYPES),
  title: z.string().trim().min(1).max(256),
  body: z.string().trim().min(1).max(4000),
  imageUrl: publicHttpsUrl.nullable(),
  color: hexColor.nullable(),
  channelId: snowflakeSchema,
  mention: z.enum(MENTION_MODES),
  mentionRoleId: snowflakeSchema.nullable(),
});

export const createAnnouncementSchema = announcementFields.partial().extend({
  /** Prefill type/title/body from a template; explicit fields win. */
  templateId: z.string().min(1).max(64).optional(),
});
export type CreateAnnouncementInput = z.input<typeof createAnnouncementSchema>;
export const updateAnnouncementSchema = announcementFields.partial();
export type UpdateAnnouncementInput = z.input<typeof updateAnnouncementSchema>;

function checkMentionShape(mention: string, roleId: string | null | undefined, guildId: string) {
  if (mention === 'ROLE' && !roleId) throw validation('Choose a role to mention.');
  if (mention === 'ROLE' && roleId === guildId) throw validation('Use the @everyone mention mode instead of the @everyone role.');
}

export async function createAnnouncement(ctx: Ctx, raw: CreateAnnouncementInput): Promise<Announcement> {
  await requirePermission(ctx, 'announcements.create');
  const cfg = await requireModule(ctx, 'announcements');
  const input = createAnnouncementSchema.parse(raw);

  let tpl: { type: Announcement['type']; title: string; body: string } | null = null;
  if (input.templateId) {
    tpl = await ctx.db.announcementTemplate.findFirst({ where: { id: input.templateId, guildId: ctx.guildId } });
    if (!tpl) throw notFound('Template');
  }
  const title = input.title ?? tpl?.title;
  const body = input.body ?? tpl?.body;
  if (!title || !body) throw validation('A title and body are required.');
  const channelId = input.channelId ?? cfg.announcementChannelId;
  if (!channelId) throw validation('Choose a channel (no default announcement channel is configured).');
  const mention = input.mention ?? 'NONE';
  const mentionRoleId = mention === 'ROLE' ? (input.mentionRoleId ?? null) : null;
  checkMentionShape(mention, mentionRoleId, ctx.guildId);

  return ctx.db.$transaction(async (tx) => {
    const a = await tx.announcement.create({
      data: {
        guildId: ctx.guildId,
        type: input.type ?? tpl?.type ?? 'GENERAL',
        title,
        body,
        imageUrl: input.imageUrl ?? null,
        color: input.color ?? null,
        channelId,
        mention,
        mentionRoleId,
        createdById: ctx.actor.userId,
      },
    });
    await audit(ctx, { action: 'announcements.create', targetType: 'Announcement', targetId: a.id, metadata: { type: a.type, mention: a.mention, templateId: input.templateId ?? null } }, tx);
    return a;
  });
}

async function loadAnnouncement(ctx: Ctx, id: string): Promise<Announcement> {
  const a = await ctx.db.announcement.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!a) throw notFound('Announcement');
  return a;
}

export async function getAnnouncement(ctx: Ctx, id: string) {
  await requireAny(ctx, ['announcements.create', 'announcements.publish']);
  const a = await ctx.db.announcement.findFirst({
    where: { id, guildId: ctx.guildId },
    include: { deliveries: { orderBy: { createdAt: 'desc' } }, trackedLinks: true },
  });
  if (!a) throw notFound('Announcement');
  return a;
}

export const listAnnouncementsSchema = paginationSchema.extend({
  status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED']).optional(),
  type: z.enum(ANNOUNCEMENT_TYPES).optional(),
});

export async function listAnnouncements(ctx: Ctx, raw: z.input<typeof listAnnouncementsSchema> = {}): Promise<Page<Announcement>> {
  await requireAny(ctx, ['announcements.create', 'announcements.publish']);
  const f = listAnnouncementsSchema.parse(raw);
  const rows = await ctx.db.announcement.findMany({
    where: { guildId: ctx.guildId, status: f.status, type: f.type },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}

/** Mass mentions need an extra permission — checked whenever an announcement is queued. */
async function requireMentionPermission(ctx: Ctx, mention: Announcement['mention'], id: string): Promise<void> {
  if (mention === 'NONE') return;
  if (can(ctx, 'announcements.mass_mention')) return;
  await audit(ctx, { action: 'announcements.mass_mention', targetType: 'Announcement', targetId: id, result: 'DENIED', metadata: { mention } });
  throw new AppError('FORBIDDEN', 'You need the mass-mention permission to ping @everyone, @here or roles.');
}

const EDITABLE: readonly AnnouncementStatus[] = ['DRAFT', 'SCHEDULED', 'FAILED', 'CANCELLED'];

/**
 * Edit an announcement. Every edit bumps `version`, which invalidates pending
 * preview confirmations. Editing a SCHEDULED announcement requires publish
 * rights (and mass-mention rights if it pings), cancels the old delivery job
 * and enqueues a new one for the new version.
 */
export async function updateAnnouncement(ctx: Ctx, id: string, raw: UpdateAnnouncementInput, expectedVersion?: number): Promise<Announcement> {
  await requirePermission(ctx, 'announcements.create');
  await requireModule(ctx, 'announcements');
  const input = updateAnnouncementSchema.parse(raw);
  const a = await loadAnnouncement(ctx, id);
  if (!EDITABLE.includes(a.status)) throw invalidState('This announcement can no longer be edited.');
  if (expectedVersion !== undefined && expectedVersion !== a.version) throw conflict('This announcement changed in the meantime. Reload and try again.');

  const mention = input.mention ?? a.mention;
  const mentionRoleId = mention === 'ROLE' ? (input.mentionRoleId !== undefined ? input.mentionRoleId : a.mentionRoleId) : null;
  checkMentionShape(mention, mentionRoleId, ctx.guildId);

  const scheduled = a.status === 'SCHEDULED';
  if (scheduled) {
    await requirePermission(ctx, 'announcements.publish', 'announcements.update');
    await requireMentionPermission(ctx, mention, id);
  }

  const nextVersion = a.version + 1;
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.announcement.updateMany({
      where: { id, version: a.version, status: a.status },
      data: {
        ...input,
        mention,
        mentionRoleId,
        version: nextVersion,
        ...(scheduled ? { publishedById: ctx.actor.userId } : {}),
      },
    });
    if (res.count === 0) throw conflict('This announcement changed in the meantime. Reload and try again.');
    if (scheduled && a.scheduledFor) {
      await cancelJob(tx, announcementJobKey(id, a.version));
      await enqueueJob(tx, {
        type: ANNOUNCEMENT_PUBLISH_JOB,
        dedupeKey: announcementJobKey(id, nextVersion),
        runAt: a.scheduledFor,
        guildId: ctx.guildId,
        payload: { announcementId: id, version: nextVersion },
        maxAttempts: 3,
      });
    }
    await audit(ctx, { action: 'announcements.update', targetType: 'Announcement', targetId: id, metadata: { fields: Object.keys(input), version: nextVersion, scheduled, mention } }, tx);
    return tx.announcement.findUniqueOrThrow({ where: { id } });
  });
}

export async function deleteAnnouncement(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'announcements.create');
  const a = await loadAnnouncement(ctx, id);
  if (!['DRAFT', 'CANCELLED', 'FAILED'].includes(a.status)) throw invalidState('Only drafts, cancelled or failed announcements can be deleted.');
  await ctx.db.$transaction(async (tx) => {
    const r = await tx.announcement.deleteMany({ where: { id, status: a.status, version: a.version } });
    if (r.count === 0) throw conflict('This announcement changed in the meantime.');
    await audit(ctx, { action: 'announcements.delete', targetType: 'Announcement', targetId: id, metadata: { status: a.status } }, tx);
  });
}

// ─── Preview / publish / schedule ───────────────────────────────────────────

export interface AnnouncementPreview {
  id: string;
  version: number;
  status: AnnouncementStatus;
  channelId: string;
  payload: MessageBody;
  /** Non-null when members will be pinged: the UI MUST require a second explicit confirmation. */
  warning: string | null;
  requiresMentionConfirmation: boolean;
  canMassMention: boolean;
}

export async function previewAnnouncement(ctx: Ctx, id: string, counts: { roleMemberCount?: number | null } = {}): Promise<AnnouncementPreview> {
  await requireAny(ctx, ['announcements.create', 'announcements.publish']);
  const a = await loadAnnouncement(ctx, id);
  const [cfg, guild] = await Promise.all([getGuildConfig(ctx.db, ctx.guildId), ctx.db.guild.findUnique({ where: { id: ctx.guildId }, select: { memberCount: true } })]);
  const warning = mentionWarning(a.mention, a.mentionRoleId, { memberCount: guild?.memberCount || null, roleMemberCount: counts.roleMemberCount });
  return {
    id: a.id,
    version: a.version,
    status: a.status,
    channelId: a.channelId,
    payload: renderAnnouncement(a, { footer: cfg.embedFooter, now: ctx.now() }),
    warning,
    requiresMentionConfirmation: a.mention !== 'NONE',
    canMassMention: can(ctx, 'announcements.mass_mention'),
  };
}

const QUEUEABLE: readonly AnnouncementStatus[] = ['DRAFT', 'SCHEDULED', 'FAILED', 'CANCELLED'];

export interface QueueOptions {
  /** Version the actor confirmed in the preview; rejects if the announcement changed since. */
  expectedVersion?: number;
  /** Explicit confirmation of the mention warning. Required when the announcement pings. */
  confirmMentions?: boolean;
}

/**
 * Queue an announcement for delivery at `runAt`. Always bumps the version so
 * the job's dedupe key is fresh (a previous cancelled/failed run can never block
 * or duplicate the new one), and cancels any job for the previous version.
 */
async function queueAnnouncement(ctx: Ctx, id: string, runAt: Date, opts: QueueOptions, action: string): Promise<Announcement> {
  await requirePermission(ctx, 'announcements.publish', action);
  await requireModule(ctx, 'announcements');
  const a = await loadAnnouncement(ctx, id);
  if (!QUEUEABLE.includes(a.status)) throw invalidState(a.status === 'PUBLISHED' ? 'This announcement was already published.' : 'This announcement is being published right now.');
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== a.version) {
    throw conflict('This announcement was edited after you previewed it. Preview it again before publishing.');
  }
  await requireMentionPermission(ctx, a.mention, id);
  if (a.mention !== 'NONE' && !opts.confirmMentions) {
    throw validation('This announcement pings members. Confirm the mention warning to continue.');
  }
  checkMentionShape(a.mention, a.mentionRoleId, ctx.guildId);

  const nextVersion = a.version + 1;
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.announcement.updateMany({
      where: { id, version: a.version, status: a.status },
      data: { status: 'SCHEDULED', scheduledFor: runAt, version: nextVersion, publishedById: ctx.actor.userId },
    });
    if (res.count === 0) throw conflict('This announcement changed in the meantime. Preview it again.');
    await cancelJob(tx, announcementJobKey(id, a.version));
    await enqueueJob(tx, {
      type: ANNOUNCEMENT_PUBLISH_JOB,
      dedupeKey: announcementJobKey(id, nextVersion),
      runAt,
      guildId: ctx.guildId,
      payload: { announcementId: id, version: nextVersion },
      maxAttempts: 3,
    });
    // The mass-mention authorisation is recorded here; delivery relies on it.
    await audit(ctx, { action, targetType: 'Announcement', targetId: id, metadata: { runAt: runAt.toISOString(), version: nextVersion, mention: a.mention, mentionRoleId: a.mentionRoleId, channelId: a.channelId } }, tx);
    return tx.announcement.findUniqueOrThrow({ where: { id } });
  });
}

/** Publish as soon as the worker picks it up (seconds). */
export async function publishAnnouncement(ctx: Ctx, id: string, opts: QueueOptions = {}): Promise<Announcement> {
  return queueAnnouncement(ctx, id, ctx.now(), opts, 'announcements.publish');
}

export const scheduleSchema = z.object({
  when: z.string().trim().min(10).max(32),
  timezone: z.string().trim().min(1).max(64).optional(),
});

/** Schedule using wall-clock input in the given (or guild) time zone; stored in UTC. */
export async function scheduleAnnouncement(ctx: Ctx, id: string, raw: z.input<typeof scheduleSchema>, opts: QueueOptions = {}): Promise<Announcement> {
  const input = scheduleSchema.parse(raw);
  const cfg = await getGuildConfig(ctx.db, ctx.guildId);
  const runAt = parseScheduleInput(input.when, input.timezone ?? cfg.timezone);
  return scheduleAnnouncementAt(ctx, id, runAt, opts);
}

/** Validate that a UTC instant is an acceptable schedule time. */
export function assertSchedulable(runAt: Date, now: Date): void {
  if (Number.isNaN(runAt.getTime())) throw validation('That time is not valid.');
  if (runAt.getTime() < now.getTime() + 60_000) throw validation('Pick a time at least one minute in the future.');
  if (runAt.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) throw validation('Announcements can be scheduled at most a year ahead.');
}

/** Schedule at an already-resolved UTC instant (e.g. from a confirmation button). */
export async function scheduleAnnouncementAt(ctx: Ctx, id: string, runAt: Date, opts: QueueOptions = {}): Promise<Announcement> {
  assertSchedulable(runAt, ctx.now());
  return queueAnnouncement(ctx, id, runAt, opts, 'announcements.schedule');
}

export async function cancelAnnouncement(ctx: Ctx, id: string): Promise<Announcement> {
  await requirePermission(ctx, 'announcements.publish', 'announcements.cancel');
  const a = await loadAnnouncement(ctx, id);
  if (a.status !== 'SCHEDULED') throw invalidState(a.status === 'PUBLISHING' ? 'This announcement is being published right now and can no longer be cancelled.' : 'Only scheduled announcements can be cancelled.');
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.announcement.updateMany({ where: { id, status: 'SCHEDULED', version: a.version }, data: { status: 'CANCELLED' } });
    if (res.count === 0) throw conflict('This announcement changed in the meantime.');
    await cancelJob(tx, announcementJobKey(id, a.version));
    await audit(ctx, { action: 'announcements.cancel', targetType: 'Announcement', targetId: id, metadata: { version: a.version } }, tx);
    return tx.announcement.findUniqueOrThrow({ where: { id } });
  });
}

// ─── Delivery (worker) ──────────────────────────────────────────────────────

export type DeliveryOutcome = 'published' | 'skipped' | 'already-delivered' | 'failed' | 'interrupted';

/**
 * Worker handler body for `marketing.announcement.publish`.
 *
 * At-most-once by design (mass notifications must never double-post):
 *  1. Skip unless the announcement is SCHEDULED/PUBLISHING at exactly this version.
 *  2. Move SCHEDULED → PUBLISHING (conditional), then insert the delivery row
 *     (unique idempotencyKey `${id}:${version}`) with success=false BEFORE sending.
 *  3. Send; on success store messageId/success, on error store the error.
 *  4. If a retry finds a pending delivery row (no messageId, no error) the previous
 *     attempt crashed mid-send — Discord may or may not have posted it. We do NOT
 *     re-send: the announcement becomes FAILED and staff retry manually after
 *     checking the channel (re-publishing bumps the version).
 */
export async function deliverAnnouncement(
  deps: ServiceDeps & { discord: DiscordPort },
  payload: { announcementId?: string; version?: number },
): Promise<DeliveryOutcome> {
  const { db } = deps;
  const id = payload.announcementId ?? '';
  const version = Number(payload.version);
  const a = await db.announcement.findUnique({ where: { id } });
  if (!a || a.version !== version) return 'skipped'; // deleted or superseded by an edit
  if (a.status !== 'SCHEDULED' && a.status !== 'PUBLISHING') return 'skipped'; // cancelled / already done
  const sys = makeCtx(deps, a.guildId, systemActor('worker'));

  if (a.status === 'SCHEDULED') {
    const r = await db.announcement.updateMany({ where: { id, version, status: 'SCHEDULED' }, data: { status: 'PUBLISHING' } });
    if (r.count === 0) return 'skipped'; // cancelled or edited concurrently
  }

  const key = deliveryKey(id, version);
  const existing = await db.announcementDelivery.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.success) {
      await db.announcement.updateMany({ where: { id, version, status: 'PUBLISHING' }, data: { status: 'PUBLISHED', publishedAt: a.publishedAt ?? existing.createdAt } });
      return 'already-delivered';
    }
    if (!existing.error) {
      await db.$transaction(async (tx) => {
        await tx.announcementDelivery.update({
          where: { id: existing.id },
          data: { error: 'Interrupted during sending; not re-sent to avoid a duplicate post. Check the channel, then publish again if needed.', attempt: { increment: 1 } },
        });
        await tx.announcement.updateMany({ where: { id, version }, data: { status: 'FAILED' } });
        await audit(sys, { action: 'announcements.delivery.interrupted', targetType: 'Announcement', targetId: id, result: 'FAILURE', metadata: { version } }, tx);
      });
      return 'interrupted';
    }
    await db.announcement.updateMany({ where: { id, version }, data: { status: 'FAILED' } });
    return 'failed';
  }

  let deliveryId: string;
  try {
    const d = await db.announcementDelivery.create({ data: { announcementId: id, idempotencyKey: key, channelId: a.channelId, success: false } });
    deliveryId = d.id;
  } catch (e) {
    if (isUniqueViolation(e)) return 'skipped'; // another worker is delivering this version
    throw e;
  }

  const cfg = await getGuildConfig(db, a.guildId);
  let messageId: string;
  try {
    const body = renderAnnouncement(a, { footer: cfg.embedFooter, now: deps.now() });
    messageId = (await deps.discord.sendMessage(a.channelId, body)).id;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await db.$transaction(async (tx) => {
      await tx.announcementDelivery.update({ where: { id: deliveryId }, data: { error: message } });
      await tx.announcement.updateMany({ where: { id, version }, data: { status: 'FAILED' } });
      await audit(sys, { action: 'announcements.delivery.failed', targetType: 'Announcement', targetId: id, result: 'FAILURE', metadata: { version, channelId: a.channelId } }, tx);
    });
    deps.log.error({ err, announcementId: id }, 'announcement delivery failed');
    return 'failed';
  }

  await db.$transaction(async (tx) => {
    await tx.announcementDelivery.update({ where: { id: deliveryId }, data: { messageId, success: true } });
    await tx.announcement.updateMany({ where: { id, version }, data: { status: 'PUBLISHED', publishedAt: deps.now() } });
    await audit(sys, { action: 'announcements.delivered', targetType: 'Announcement', targetId: id, metadata: { version, channelId: a.channelId, messageId, mention: a.mention, authorisedBy: a.publishedById } }, tx);
  });
  return 'published';
}

// ─── Engagement (honest analytics) ──────────────────────────────────────────

export const ENGAGEMENT_WINDOW_DAYS = 14;

/** Successful deliveries of announcements published within the engagement window. */
export async function deliveriesForEngagementRefresh(db: Db, guildId: string, now: Date) {
  const since = new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * 86_400_000);
  return db.announcementDelivery.findMany({
    where: { success: true, messageId: { not: null }, announcement: { guildId, status: 'PUBLISHED', publishedAt: { gte: since } } },
    select: { id: true, channelId: true, messageId: true },
    take: 200,
  });
}

export async function recordReactionCount(db: Db, deliveryId: string, count: number): Promise<void> {
  await db.announcementDelivery.update({ where: { id: deliveryId }, data: { reactionCount: Math.max(0, Math.floor(count)) } });
}

/**
 * Engagement we can actually measure: total reactions (refreshed periodically
 * for 14 days after publishing) and tracked-link clicks. Discord does not expose
 * impressions or views, so none are reported.
 */
export async function getAnnouncementAnalytics(ctx: Ctx, id: string) {
  await requireAny(ctx, ['announcements.create', 'announcements.publish', 'analytics.view']);
  const a = await ctx.db.announcement.findFirst({
    where: { id, guildId: ctx.guildId },
    include: { deliveries: { where: { success: true } }, trackedLinks: { select: { id: true, slug: true, targetUrl: true, clicks: true } } },
  });
  if (!a) throw notFound('Announcement');
  const reactions = a.deliveries.reduce((s, d) => s + d.reactionCount, 0);
  return {
    id: a.id,
    status: a.status,
    publishedAt: a.publishedAt,
    reactions,
    reactionsNote: `Reaction totals are refreshed periodically for ${ENGAGEMENT_WINDOW_DAYS} days after publishing.`,
    linkClicks: a.trackedLinks.reduce((s, l) => s + l.clicks, 0),
    links: a.trackedLinks,
    impressions: null,
    impressionsNote: 'Discord does not provide view or impression counts.',
  };
}
