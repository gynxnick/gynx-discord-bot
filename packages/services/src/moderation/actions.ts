import { z } from 'zod';
import type { Db, ModerationAction, ModerationType, Prisma, Warning } from '@gynx/database';
import { resolvePermissions, type PermissionKey } from '@gynx/permissions';
import {
  cursorArgs,
  forbidden,
  invalidState,
  notFound,
  paginationSchema,
  parseDuration,
  redactSecrets,
  toPage,
  validation,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requireAny, requirePermission } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { cancelJob, enqueueJob } from '../core/jobs';
import { suggestEscalation, type EscalationSuggestion } from './automod-engine';
import {
  AUTOMOD_MODERATOR_ID,
  SYSTEM_MODERATOR_ID,
  TEMPBAN_MAX_MS,
  TEMPBAN_MIN_MS,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
  WARNING_EXPIRY_DAYS,
  expiryJobKey,
  insertAction,
  parseInput,
  snowflake,
} from './common';
import { checkHierarchy, isStaffPermissionSet } from './hierarchy';

/** Action types a moderator (or automod) can request. MESSAGE_DELETE is recorded by automod events instead. */
export const MANUAL_ACTION_TYPES = ['WARN', 'TIMEOUT', 'UNTIMEOUT', 'KICK', 'BAN', 'UNBAN'] as const;
export type ManualActionType = (typeof MANUAL_ACTION_TYPES)[number];

export const ACTION_PERMISSION: Record<ManualActionType, PermissionKey> = {
  WARN: 'moderation.execute',
  TIMEOUT: 'moderation.execute',
  UNTIMEOUT: 'moderation.execute',
  KICK: 'moderation.execute',
  BAN: 'moderation.ban',
  UNBAN: 'moderation.ban',
};

export const ACTION_LABELS: Record<ModerationType, string> = {
  WARN: 'Warning',
  TIMEOUT: 'Timeout',
  UNTIMEOUT: 'Timeout removed',
  KICK: 'Kick',
  BAN: 'Ban',
  UNBAN: 'Unban',
  MESSAGE_DELETE: 'Message deleted',
};

/** Types whose Discord effect requires the bot to outrank the target. */
const NEEDS_BOT_HIERARCHY: readonly ManualActionType[] = ['TIMEOUT', 'UNTIMEOUT', 'KICK', 'BAN'];
/** Types subject to member hierarchy checks at all (UNBAN targets are not members). */
const HIERARCHY_CHECKED: readonly ManualActionType[] = ['WARN', 'TIMEOUT', 'UNTIMEOUT', 'KICK', 'BAN'];

export const prepareActionSchema = z.object({
  type: z.enum(MANUAL_ACTION_TYPES),
  targetId: snowflake,
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters.').max(512, 'Reason must be at most 512 characters.'),
  /** e.g. "30m", "2h", "7d". Required for TIMEOUT, optional (temp ban) for BAN. */
  duration: z.string().trim().max(32).optional(),
  deleteMessageDays: z.number().int().min(0).max(7).optional(),
  moderatorNote: z.string().trim().max(1000).optional(),
  /** System callers only: links the action to the automod event that triggered it. */
  automodEventId: z.string().min(1).max(64).optional(),
});
export type PrepareActionInput = z.input<typeof prepareActionSchema>;

/** Gateway facts the bot supplies for hierarchy checks (role positions, owner, …). */
export interface HierarchySubject {
  actorHighest: number;
  /** null when the target is not a guild member. */
  targetHighest: number | null;
  botHighest: number;
  guildOwnerId: string;
  targetIsBot?: boolean;
  targetRoleIds?: readonly string[];
}

/** Validated plan returned by `prepareAction`; the bot applies it on Discord then calls `recordAction`. */
export interface ModerationPlan {
  readonly guildId: string;
  readonly type: ManualActionType;
  readonly targetId: string;
  readonly reason: string;
  readonly durationMs: number | null;
  readonly deleteMessageSeconds: number;
  readonly moderatorId: string;
  readonly moderatorNote: string | null;
  readonly automodEventId: string | null;
}

export interface ActionResult {
  applied: boolean;
  error?: string;
  dmSent: boolean;
}

function resolveDuration(type: ManualActionType, raw: string | undefined): number | null {
  if (type === 'TIMEOUT') {
    if (!raw) throw validation('A duration is required for a timeout (e.g. 30m, 2h, 1d).');
    const ms = parseDuration(raw);
    if (ms === null) throw validation('Invalid duration. Use a format like 30m, 2h or 1d.');
    if (ms < TIMEOUT_MIN_MS || ms > TIMEOUT_MAX_MS) throw validation('Timeouts must be between 1 minute and 28 days.');
    return ms;
  }
  if (type === 'BAN') {
    if (!raw) return null; // permanent
    const ms = parseDuration(raw);
    if (ms === null) throw validation('Invalid duration. Use a format like 12h, 7d or 4w.');
    if (ms < TEMPBAN_MIN_MS || ms > TEMPBAN_MAX_MS) throw validation('Temporary bans must be between 1 minute and 365 days.');
    return ms;
  }
  if (raw) throw validation(`A duration cannot be set for ${type.toLowerCase()}.`);
  return null;
}

/**
 * Validate a moderation request: input, permission (`moderation.execute` or
 * `moderation.ban`), and role hierarchy. Denials are audited. Performs no writes
 * on success — the caller applies the plan on Discord, then calls `recordAction`.
 */
export async function prepareAction(ctx: Ctx, raw: PrepareActionInput, subject?: HierarchySubject): Promise<ModerationPlan> {
  await requireModule(ctx, 'moderation');
  const input = parseInput(prepareActionSchema, raw);
  const auditAction = `moderation.${input.type.toLowerCase()}`;
  await requirePermission(ctx, ACTION_PERMISSION[input.type], auditAction);
  if (input.automodEventId && !ctx.actor.isSystem) throw forbidden();

  const durationMs = resolveDuration(input.type, input.duration);
  if (input.deleteMessageDays && input.type !== 'BAN') throw validation('Message deletion only applies to bans.');

  if (HIERARCHY_CHECKED.includes(input.type)) {
    if (!subject) throw validation('Member information is required for this action.');
    if (subject.targetIsBot && (input.type === 'WARN' || input.type === 'TIMEOUT')) {
      throw validation('Bots cannot be warned or timed out. Kick or ban them instead.');
    }
    const grants = await ctx.db.staffPermission.findMany({
      where: { guildId: ctx.guildId },
      select: { subjectType: true, subjectId: true, permission: true, effect: true },
    });
    const targetPerms = resolvePermissions(
      { userId: input.targetId, roleIds: subject.targetRoleIds ?? [], isGuildOwner: input.targetId === subject.guildOwnerId },
      grants,
    );
    const verdict = checkHierarchy({
      actorId: ctx.actor.userId,
      actorHighest: subject.actorHighest,
      targetId: input.targetId,
      targetHighest: subject.targetHighest,
      botHighest: subject.botHighest,
      guildOwnerId: subject.guildOwnerId,
      targetIsBot: subject.targetIsBot,
      targetIsStaff: isStaffPermissionSet(targetPerms),
      actorCanBan: can(ctx, 'moderation.ban'),
      requiresBot: NEEDS_BOT_HIERARCHY.includes(input.type),
    });
    if (!verdict.ok) {
      await audit(ctx, { action: auditAction, targetType: 'User', targetId: input.targetId, result: 'DENIED', metadata: { reason: 'hierarchy', detail: verdict.reason } });
      throw forbidden(verdict.reason);
    }
  }

  return {
    guildId: ctx.guildId,
    type: input.type,
    targetId: input.targetId,
    reason: redactSecrets(input.reason, { maskIps: false }),
    durationMs,
    deleteMessageSeconds: (input.deleteMessageDays ?? 0) * 86_400,
    moderatorId: input.automodEventId ? AUTOMOD_MODERATOR_ID : ctx.actor.userId,
    moderatorNote: input.moderatorNote ? redactSecrets(input.moderatorNote, { maskIps: false }) : null,
    automodEventId: input.automodEventId ?? null,
  };
}

export interface RecordedAction {
  action: ModerationAction;
  /** For WARN: active warnings after this one, and the advisory next step (never auto-applied). */
  activeWarnings: number | null;
  suggestion: EscalationSuggestion | null;
}

/**
 * Persist the outcome of a plan the bot applied (or failed to apply). Writes
 * the ModerationAction (status FAILED when Discord rejected it), a Warning for
 * WARN, the audit event, a modlog job and — for timed actions — an expiry job.
 */
export async function recordAction(ctx: Ctx, plan: ModerationPlan, result: ActionResult): Promise<RecordedAction> {
  if (plan.guildId !== ctx.guildId) throw forbidden();
  if (!can(ctx, ACTION_PERMISSION[plan.type])) throw forbidden();
  const now = ctx.now();
  const applied = result.applied;
  const expiresAt = applied && plan.durationMs ? new Date(now.getTime() + plan.durationMs) : null;

  const action = await ctx.db.$transaction(async (tx) => {
    const a = await insertAction(
      tx,
      {
        guildId: ctx.guildId,
        type: plan.type,
        targetId: plan.targetId,
        moderatorId: plan.moderatorId,
        reason: plan.reason,
        durationSeconds: plan.durationMs ? Math.round(plan.durationMs / 1000) : null,
        expiresAt,
        status: applied ? 'APPLIED' : 'FAILED',
        failureReason: applied ? null : (result.error ?? 'Discord rejected the action.'),
        dmSent: result.dmSent,
        moderatorNote: plan.moderatorNote,
        automodEventId: plan.automodEventId,
      },
      now,
    );

    if (applied) {
      if (plan.type === 'WARN') {
        await tx.warning.create({
          data: {
            guildId: ctx.guildId,
            userId: plan.targetId,
            moderatorId: plan.moderatorId,
            reason: plan.reason,
            actionId: a.id,
            expiresAt: new Date(now.getTime() + WARNING_EXPIRY_DAYS * 86_400_000),
          },
        });
      }
      // A new timeout supersedes an older one; un-actions reverse the active original.
      const supersedes: ModerationType | null =
        plan.type === 'UNBAN' ? 'BAN' : plan.type === 'UNTIMEOUT' || plan.type === 'TIMEOUT' ? 'TIMEOUT' : plan.type === 'BAN' ? 'BAN' : null;
      if (supersedes) await reverseActive(tx, ctx.guildId, plan.targetId, supersedes, a.id);
      if (expiresAt && (plan.type === 'BAN' || plan.type === 'TIMEOUT')) {
        await enqueueJob(tx, {
          type: 'moderation.expire',
          dedupeKey: expiryJobKey(a.id),
          runAt: expiresAt,
          guildId: ctx.guildId,
          payload: { actionId: a.id },
        });
      }
    }

    await audit(
      ctx,
      {
        action: `moderation.${plan.type.toLowerCase()}`,
        targetType: 'User',
        targetId: plan.targetId,
        result: applied ? 'SUCCESS' : 'FAILURE',
        metadata: {
          ref: a.ref,
          actionId: a.id,
          durationSeconds: a.durationSeconds,
          dmSent: result.dmSent,
          automod: plan.moderatorId === AUTOMOD_MODERATOR_ID,
          ...(applied ? {} : { error: (result.error ?? '').slice(0, 200) }),
        },
      },
      tx,
    );
    return a;
  });

  if (plan.type !== 'WARN' || !applied) return { action, activeWarnings: null, suggestion: null };
  const cfg = await loadEscalationConfig(ctx.db, ctx.guildId);
  const activeWarnings = await countActiveWarnings(ctx.db, ctx.guildId, plan.targetId, now);
  return { action, activeWarnings, suggestion: suggestEscalation(activeWarnings, cfg) };
}

/** Mark earlier APPLIED actions of `type` against the target as REVERSED and cancel their expiry jobs. */
async function reverseActive(tx: Db, guildId: string, targetId: string, type: ModerationType, exceptId: string): Promise<void> {
  const active = await tx.moderationAction.findMany({
    where: { guildId, targetId, type, status: 'APPLIED', id: { not: exceptId } },
    select: { id: true },
  });
  if (active.length === 0) return;
  await tx.moderationAction.updateMany({ where: { id: { in: active.map((r) => r.id) } }, data: { status: 'REVERSED' } });
  for (const r of active) await cancelJob(tx, expiryJobKey(r.id));
}

async function loadEscalationConfig(db: Db, guildId: string) {
  const cfg = await db.automodConfig.findUnique({
    where: { guildId },
    select: { warnAtStrikes: true, timeoutAtStrikes: true, timeoutMinutes: true },
  });
  return cfg ?? { warnAtStrikes: 2, timeoutAtStrikes: 4, timeoutMinutes: 30 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expiry (worker)
// ─────────────────────────────────────────────────────────────────────────────

export type UnbanFn = (guildId: string, userId: string, reason: string) => Promise<void>;

/**
 * Expire a timed action. Idempotent: only an APPLIED action transitions (conditional
 * update), so running twice records a single UNBAN. For temp bans the Discord unban
 * happens first; a crash before the DB update simply retries the (idempotent) unban.
 */
export async function expireAction(ctx: Ctx, actionId: string, unban: UnbanFn): Promise<ModerationAction | null> {
  if (!ctx.actor.isSystem) throw forbidden();
  const action = await ctx.db.moderationAction.findFirst({ where: { id: actionId, guildId: ctx.guildId } });
  if (!action || action.status !== 'APPLIED' || (action.type !== 'BAN' && action.type !== 'TIMEOUT')) return null;
  if (action.expiresAt && action.expiresAt.getTime() > ctx.now().getTime()) throw invalidState('Action has not expired yet.');

  if (action.type === 'BAN') await unban(ctx.guildId, action.targetId, `Temporary ban ${action.ref} expired`);

  return ctx.db.$transaction(async (tx) => {
    const res = await tx.moderationAction.updateMany({ where: { id: action.id, status: 'APPLIED' }, data: { status: 'EXPIRED' } });
    if (res.count === 0) return null;
    await audit(ctx, { action: 'moderation.expire', targetType: 'ModerationAction', targetId: action.id, metadata: { ref: action.ref, type: action.type } }, tx);
    if (action.type !== 'BAN') return null;
    const unbanAction = await insertAction(
      tx,
      {
        guildId: ctx.guildId,
        type: 'UNBAN',
        targetId: action.targetId,
        moderatorId: SYSTEM_MODERATOR_ID,
        reason: `Temporary ban ${action.ref} expired`,
        status: 'APPLIED',
      },
      ctx.now(),
    );
    await audit(ctx, { action: 'moderation.unban', targetType: 'User', targetId: action.targetId, metadata: { ref: unbanAction.ref, actionId: unbanAction.id, expired: action.ref } }, tx);
    return unbanAction;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Warnings
// ─────────────────────────────────────────────────────────────────────────────

const activeWarningWhere = (guildId: string, userId: string, now: Date): Prisma.WarningWhereInput => ({
  guildId,
  userId,
  active: true,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

export async function countActiveWarnings(db: Db, guildId: string, userId: string, now: Date): Promise<number> {
  return db.warning.count({ where: activeWarningWhere(guildId, userId, now) });
}

export async function listWarnings(ctx: Ctx, userId: string, opts: { includeInactive?: boolean } = {}): Promise<Warning[]> {
  await requirePermission(ctx, 'moderation.audit.view', 'moderation.warnings.view');
  const uid = parseInput(snowflake, userId);
  return ctx.db.warning.findMany({
    where: opts.includeInactive ? { guildId: ctx.guildId, userId: uid } : activeWarningWhere(ctx.guildId, uid, ctx.now()),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
}

export interface WarningSummary {
  warnings: Array<Warning & { ref: string }>;
  activeCount: number;
  suggestion: EscalationSuggestion;
}

/** Active warnings with refs + the advisory escalation (for /warnings and the dashboard member view). */
export async function getWarningSummary(ctx: Ctx, userId: string): Promise<WarningSummary> {
  await requirePermission(ctx, 'moderation.audit.view', 'moderation.warnings.view');
  const uid = parseInput(snowflake, userId);
  const rows = await ctx.db.warning.findMany({
    where: activeWarningWhere(ctx.guildId, uid, ctx.now()),
    include: { action: { select: { ref: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
  });
  const cfg = await loadEscalationConfig(ctx.db, ctx.guildId);
  return {
    warnings: rows.map(({ action, ...w }) => ({ ...w, ref: action.ref })),
    activeCount: rows.length,
    suggestion: suggestEscalation(rows.length, cfg),
  };
}

export async function revokeWarning(ctx: Ctx, warningId: string, reason: string): Promise<Warning> {
  await requirePermission(ctx, 'moderation.execute', 'moderation.warning.revoke');
  const why = parseInput(z.string().trim().min(3).max(512), reason);
  const w = await ctx.db.warning.findFirst({ where: { id: warningId, guildId: ctx.guildId } });
  if (!w) throw notFound('Warning');
  if (!w.active) throw invalidState('This warning is already inactive.');
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.warning.updateMany({ where: { id: w.id, active: true }, data: { active: false } });
    if (res.count === 0) throw invalidState('This warning is already inactive.');
    await tx.moderationAction.updateMany({ where: { id: w.actionId, status: 'APPLIED' }, data: { status: 'REVERSED' } });
    await audit(ctx, { action: 'moderation.warning.revoke', targetType: 'Warning', targetId: w.id, metadata: { userId: w.userId, actionId: w.actionId, reasonLength: why.length } }, tx);
    return tx.warning.findUniqueOrThrow({ where: { id: w.id } });
  });
}

/** Periodic: warnings past `expiresAt` stop counting (active=false). Returns rows changed. */
export async function expireWarnings(db: Db, now: Date, guildId?: string): Promise<number> {
  const r = await db.warning.updateMany({
    where: { active: true, expiresAt: { lte: now }, ...(guildId ? { guildId } : {}) },
    data: { active: false },
  });
  return r.count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Records, notes, search
// ─────────────────────────────────────────────────────────────────────────────

/** `moderatorNote` is only visible to holders of `moderation.audit.view`. */
export function projectAction(ctx: Ctx, a: ModerationAction): ModerationAction {
  return can(ctx, 'moderation.audit.view') ? a : { ...a, moderatorNote: null };
}

export const searchActionsSchema = paginationSchema.extend({
  type: z.enum(['WARN', 'TIMEOUT', 'UNTIMEOUT', 'KICK', 'BAN', 'UNBAN', 'MESSAGE_DELETE']).optional(),
  status: z.enum(['APPLIED', 'FAILED', 'EXPIRED', 'REVERSED']).optional(),
  targetId: snowflake.optional(),
  moderatorId: z.union([snowflake, z.literal(AUTOMOD_MODERATOR_ID), z.literal(SYSTEM_MODERATOR_ID)]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Exact reference, e.g. M-0042. */
  ref: z.string().trim().max(16).optional(),
});

/** Dashboard records search. Requires `moderation.audit.view` or `moderation.execute`. */
export async function searchActions(ctx: Ctx, raw: z.input<typeof searchActionsSchema>): Promise<Page<ModerationAction>> {
  await requireAny(ctx, ['moderation.audit.view', 'moderation.execute'], 'moderation.records.view');
  const f = parseInput(searchActionsSchema, raw);
  const where: Prisma.ModerationActionWhereInput = {
    guildId: ctx.guildId,
    type: f.type,
    status: f.status,
    targetId: f.targetId,
    moderatorId: f.moderatorId,
    ref: f.ref ? f.ref.toUpperCase() : undefined,
    createdAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
  };
  const rows = await ctx.db.moderationAction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(f) });
  const page = toPage(rows, f.limit);
  return { ...page, items: page.items.map((a) => projectAction(ctx, a)) };
}

export async function getAction(ctx: Ctx, idOrRef: string): Promise<ModerationAction> {
  await requireAny(ctx, ['moderation.audit.view', 'moderation.execute'], 'moderation.records.view');
  const key = idOrRef.trim();
  const a = await ctx.db.moderationAction.findFirst({
    where: { guildId: ctx.guildId, OR: [{ id: key }, { ref: key.toUpperCase() }] },
  });
  if (!a) throw notFound('Moderation record');
  return projectAction(ctx, a);
}

export async function setModeratorNote(ctx: Ctx, actionId: string, note: string | null): Promise<ModerationAction> {
  await requirePermission(ctx, 'moderation.audit.view', 'moderation.note');
  const text = note === null ? null : parseInput(z.string().trim().max(1000), note) || null;
  const a = await ctx.db.moderationAction.findFirst({ where: { id: actionId, guildId: ctx.guildId } });
  if (!a) throw notFound('Moderation record');
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.moderationAction.update({
      where: { id: a.id },
      data: { moderatorNote: text ? redactSecrets(text, { maskIps: false }) : null },
    });
    await audit(ctx, { action: 'moderation.note', targetType: 'ModerationAction', targetId: a.id, metadata: { ref: a.ref, cleared: text === null } }, tx);
    return updated;
  });
}

/** What a member may see about their own records: no moderator identity, no notes. */
export interface OwnActionView {
  id: string;
  ref: string;
  type: ModerationType;
  reason: string;
  createdAt: Date;
}

/** The invoking member's own appealable actions (used by /appeal autocomplete). */
export async function listOwnActions(ctx: Ctx, query = ''): Promise<OwnActionView[]> {
  const q = query.trim().toUpperCase().slice(0, 16);
  return ctx.db.moderationAction.findMany({
    where: {
      guildId: ctx.guildId,
      targetId: ctx.actor.userId,
      status: 'APPLIED',
      type: { in: ['WARN', 'TIMEOUT', 'KICK', 'BAN'] },
      ...(q ? { ref: { contains: q } } : {}),
    },
    select: { id: true, ref: true, type: true, reason: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
}
