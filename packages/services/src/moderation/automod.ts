import { z } from 'zod';
import {
  ensureGuild,
  type AutomodConfig,
  type AutomodEvent,
  type AutomodRule,
  type Db,
  type Prisma,
} from '@gynx/database';
import {
  cursorArgs,
  forbidden,
  invalidState,
  notFound,
  paginationSchema,
  redactSecrets,
  toPage,
  truncate,
  validation,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { requireAny, requirePermission } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { decideAutomodAction, type AutomodDecision } from './automod-engine';
import { parseInput, snowflake } from './common';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:xn--[a-z0-9-]{2,59}|[a-z]{2,63})$/;

/** Accepts "Example.com", "example.com.", "https://example.com/path" and normalises to "example.com". */
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) =>
    s
      .replace(/^[a-z]+:\/\//, '')
      .replace(/^\*\./, '')
      .split(/[/?#]/)[0]!
      .replace(/\.+$/, ''),
  )
  .refine((s) => HOSTNAME.test(s), { message: 'Domains must be hostnames like example.com' });

const uniq = <T>(a: T[]) => [...new Set(a)];

export const automodConfigUpdateSchema = z
  .object({
    enabled: z.boolean(),
    duplicateThreshold: z.number().int().min(2).max(20),
    duplicateWindowSeconds: z.number().int().min(5).max(600),
    maxMentions: z.number().int().min(2).max(50),
    burstThreshold: z.number().int().min(3).max(50),
    burstWindowSeconds: z.number().int().min(3).max(120),
    blockInvites: z.boolean(),
    allowedInviteCodes: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{2,32}$/, 'Invalid invite code'),
      )
      .max(50)
      .transform(uniq),
    blockedDomains: z.array(domain).max(500).transform(uniq),
    allowedDomains: z.array(domain).max(500).transform(uniq),
    blockedPhrases: z
      .array(
        z
          .string()
          .trim()
          .min(2, 'Phrases must be at least 2 characters')
          .max(100, 'Phrases must be at most 100 characters'),
      )
      .max(100, 'At most 100 blocked phrases')
      .transform(uniq),
    phishingDetection: z.boolean(),
    newAccountDays: z.number().int().min(0).max(90),
    exemptRoleIds: z.array(snowflake).max(50).transform(uniq),
    exemptChannelIds: z.array(snowflake).max(100).transform(uniq),
    strikeWindowHours: z.number().int().min(1).max(720),
    warnAtStrikes: z.number().int().min(1).max(20),
    timeoutAtStrikes: z.number().int().min(1).max(50),
    timeoutMinutes: z.number().int().min(1).max(40_320),
    warningExpiryDays: z.number().int().min(1).max(3650),
  })
  .partial()
  .strict();
export type AutomodConfigUpdate = z.input<typeof automodConfigUpdateSchema>;

/** Read config without permission checks — for the bot's message pipeline (not private data). */
export async function loadAutomodConfig(db: Db, guildId: string): Promise<AutomodConfig> {
  const cfg = await db.automodConfig.findUnique({ where: { guildId } });
  if (cfg) return cfg;
  await ensureGuild(db, guildId);
  return db.automodConfig.findUniqueOrThrow({ where: { guildId } });
}

export async function getAutomodConfig(ctx: Ctx): Promise<AutomodConfig> {
  await requirePermission(ctx, 'automod.manage', 'automod.config.view');
  return loadAutomodConfig(ctx.db, ctx.guildId);
}

export async function updateAutomodConfig(ctx: Ctx, raw: AutomodConfigUpdate): Promise<AutomodConfig> {
  await requirePermission(ctx, 'automod.manage', 'automod.config.update');
  const patch = parseInput(automodConfigUpdateSchema, raw);
  const current = await loadAutomodConfig(ctx.db, ctx.guildId);
  const merged = { ...current, ...patch };
  if (merged.timeoutAtStrikes <= merged.warnAtStrikes)
    throw validation('The timeout strike count must be higher than the warning strike count.');
  const overlap = merged.blockedDomains.filter((d) => merged.allowedDomains.includes(d));
  if (overlap.length)
    throw validation(`A domain cannot be both blocked and allowed: ${overlap.slice(0, 3).join(', ')}`);

  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.automodConfig.update({ where: { guildId: ctx.guildId }, data: patch });
    // Only key names + list sizes: blocked phrases themselves stay out of the audit trail.
    await audit(
      ctx,
      {
        action: 'automod.config.update',
        targetType: 'AutomodConfig',
        targetId: ctx.guildId,
        metadata: {
          changed: Object.keys(patch),
          blockedPhrases: patch.blockedPhrases?.length,
          blockedDomains: patch.blockedDomains?.length,
          allowedDomains: patch.allowedDomains?.length,
        },
      },
      tx,
    );
    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hits & escalation
// ─────────────────────────────────────────────────────────────────────────────

/** Redacted, mention-neutralised, link-defanged excerpt (≤200 chars) — raw content is never stored. */
export function automodExcerpt(content: string): string {
  // Plain-ASCII mention neutralising (no zero-width characters) keeps excerpts safe to echo anywhere.
  const cleaned = redactSecrets(content)
    .replace(/@(everyone|here)/gi, '(at)$1')
    .replace(/<@&(\d+)>/g, '@role')
    .replace(/\bhttp/gi, 'hxxp')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(cleaned, 200);
}

export const recordHitSchema = z.object({
  userId: snowflake,
  channelId: snowflake,
  rule: z.enum([
    'DUPLICATE',
    'MENTIONS',
    'BURST',
    'INVITE',
    'BLOCKED_DOMAIN',
    'PHISHING',
    'BLOCKED_PHRASE',
    'RAID',
  ]),
  content: z.string().max(4000).default(''),
});

export interface AutomodHitResult {
  event: AutomodEvent;
  decision: AutomodDecision;
}

/**
 * Store an automod hit and decide the escalation by strikes within
 * `strikeWindowHours` (events marked false-positive do not count):
 * first → DELETE, ≥warnAtStrikes → WARN, ≥timeoutAtStrikes → TIMEOUT.
 * Never bans. System actors only; the bot executes the decision via prepare/record.
 */
export async function recordAutomodHit(
  ctx: Ctx,
  raw: z.input<typeof recordHitSchema>,
): Promise<AutomodHitResult> {
  if (!ctx.actor.isSystem) throw forbidden();
  await requireModule(ctx, 'moderation');
  const input = parseInput(recordHitSchema, raw);
  const cfg = await loadAutomodConfig(ctx.db, ctx.guildId);
  const now = ctx.now();
  const since = new Date(now.getTime() - cfg.strikeWindowHours * 3_600_000);

  return ctx.db.$transaction(async (tx) => {
    // Serialise per user so concurrent hits count strikes consistently.
    await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`automod:${ctx.guildId}:${input.userId}`}))`;
    const prior = await tx.automodEvent.count({
      where: {
        guildId: ctx.guildId,
        userId: input.userId,
        createdAt: { gte: since },
        OR: [{ falsePositive: null }, { falsePositive: false }],
      },
    });
    const decision = decideAutomodAction(prior + 1, cfg);
    const event = await tx.automodEvent.create({
      data: {
        guildId: ctx.guildId,
        userId: input.userId,
        channelId: input.channelId,
        rule: input.rule as AutomodRule,
        excerpt: input.content ? automodExcerpt(input.content) : null,
        actionTaken: decision.action,
        createdAt: now,
      },
    });
    await audit(
      ctx,
      {
        action: 'automod.hit',
        targetType: 'User',
        targetId: input.userId,
        metadata: {
          eventId: event.id,
          rule: input.rule,
          decision: decision.action,
          strikes: decision.strikes,
        },
      },
      tx,
    );
    return { event, decision };
  });
}

/** Correct the stored action after the bot tried to execute a decision (e.g. timeout failed → DELETE). */
export async function setAutomodEventOutcome(
  ctx: Ctx,
  eventId: string,
  actionTaken: 'DELETE' | 'WARN' | 'TIMEOUT' | 'ALERT',
): Promise<void> {
  if (!ctx.actor.isSystem) throw forbidden();
  await ctx.db.automodEvent.updateMany({
    where: { id: eventId, guildId: ctx.guildId },
    data: { actionTaken },
  });
}

/**
 * Staff review of an automod event. Marking a false positive removes it from
 * strike counting and revokes the warning it produced (if any). Audited.
 */
export async function reviewAutomodEvent(
  ctx: Ctx,
  id: string,
  falsePositive: boolean,
): Promise<AutomodEvent> {
  await requirePermission(ctx, 'automod.manage', 'automod.event.review');
  const ev = await ctx.db.automodEvent.findFirst({
    where: { id, guildId: ctx.guildId },
    include: { moderation: true },
  });
  if (!ev) throw notFound('Automod event');
  if (ev.reviewedAt && ev.falsePositive === falsePositive)
    throw invalidState('This event was already reviewed with that outcome.');
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.automodEvent.update({
      where: { id: ev.id },
      data: { falsePositive, reviewedById: ctx.actor.userId, reviewedAt: ctx.now() },
    });
    if (falsePositive && ev.moderation?.type === 'WARN') {
      await tx.warning.updateMany({
        where: { actionId: ev.moderation.id, active: true },
        data: { active: false },
      });
      await tx.moderationAction.updateMany({
        where: { id: ev.moderation.id, status: 'APPLIED' },
        data: { status: 'REVERSED' },
      });
    }
    await audit(
      ctx,
      {
        action: 'automod.event.review',
        targetType: 'AutomodEvent',
        targetId: ev.id,
        metadata: { falsePositive, rule: ev.rule, linkedAction: ev.moderation?.ref ?? null },
      },
      tx,
    );
    return updated;
  });
}

export const listAutomodEventsSchema = paginationSchema.extend({
  rule: z
    .enum([
      'DUPLICATE',
      'MENTIONS',
      'BURST',
      'INVITE',
      'BLOCKED_DOMAIN',
      'PHISHING',
      'BLOCKED_PHRASE',
      'RAID',
    ])
    .optional(),
  userId: snowflake.optional(),
  unreviewed: z.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function listAutomodEvents(
  ctx: Ctx,
  raw: z.input<typeof listAutomodEventsSchema>,
): Promise<Page<AutomodEvent>> {
  await requireAny(ctx, ['automod.manage', 'moderation.audit.view'], 'automod.events.view');
  const f = parseInput(listAutomodEventsSchema, raw);
  const where: Prisma.AutomodEventWhereInput = {
    guildId: ctx.guildId,
    rule: f.rule,
    userId: f.userId,
    reviewedAt: f.unreviewed ? null : undefined,
    createdAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
  };
  const rows = await ctx.db.automodEvent.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}
