import { z } from 'zod';
import type { Db, MaintenanceWindow, Prisma } from '@gynx/database';
import { cursorArgs, invalidState, neutraliseMentions, notFound, paginationSchema, redactSecrets, toPage, validation, type Page } from '@gynx/shared';
import { audit } from '../core/audit';
import { requireAny, requirePermission } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { cancelJob, enqueueJob, rescheduleJob } from '../core/jobs';

const MAX_WINDOW_MS = 14 * 86_400_000;
const PAST_GRACE_MS = 5 * 60_000;

const clean = (s: string) => neutraliseMentions(redactSecrets(s.trim()));

export const maintenanceJobKeys = (id: string) => ({
  announce: `status.maintenance.announce:${id}`,
  start: `status.maintenance.start:${id}`,
  end: `status.maintenance.end:${id}`,
  cancelled: `status.maintenance.cancelled:${id}`,
});

const windowFields = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(2000),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  serviceSlugs: z.array(z.string().trim().toLowerCase().max(40)).max(25).default([]),
};
export const createMaintenanceSchema = z.object(windowFields);
export const updateMaintenanceSchema = z.object(windowFields).partial();
export type CreateMaintenanceInput = z.input<typeof createMaintenanceSchema>;

function validateWindow(startsAt: Date, endsAt: Date, now: Date, isNew: boolean) {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw validation('Invalid start or end time.');
  if (endsAt.getTime() <= startsAt.getTime()) throw validation('The maintenance must end after it starts.');
  if (endsAt.getTime() <= now.getTime()) throw validation('The maintenance end time is in the past.');
  if (isNew && startsAt.getTime() < now.getTime() - PAST_GRACE_MS) throw validation('The maintenance start time is in the past.');
  if (endsAt.getTime() - startsAt.getTime() > MAX_WINDOW_MS) throw validation('Maintenance windows can be at most 14 days long.');
}

async function serviceIdsFor(tx: Prisma.TransactionClient, guildId: string, slugs: string[]) {
  const unique = [...new Set(slugs)];
  if (!unique.length) return [];
  const rows = await tx.monitoredService.findMany({ where: { guildId, slug: { in: unique } }, select: { id: true, slug: true } });
  const missing = unique.filter((s) => !rows.some((r) => r.slug === s));
  if (missing.length) throw validation(`Unknown service(s): ${missing.join(', ')}`);
  return rows.map((r) => r.id);
}

export async function createMaintenance(ctx: Ctx, raw: CreateMaintenanceInput): Promise<MaintenanceWindow> {
  await requireModule(ctx, 'status');
  await requirePermission(ctx, 'incidents.manage', 'status.maintenance.create');
  const input = createMaintenanceSchema.parse(raw);
  const now = ctx.now();
  validateWindow(input.startsAt, input.endsAt, now, true);

  return ctx.db.$transaction(async (tx) => {
    const ids = await serviceIdsFor(tx, ctx.guildId, input.serviceSlugs);
    const w = await tx.maintenanceWindow.create({
      data: {
        guildId: ctx.guildId,
        title: clean(input.title),
        description: clean(input.description),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdById: ctx.actor.userId,
        services: { connect: ids.map((id) => ({ id })) },
      },
    });
    const keys = maintenanceJobKeys(w.id);
    const payload = { windowId: w.id };
    await enqueueJob(tx, { type: 'status.maintenance.announce', dedupeKey: keys.announce, runAt: now, guildId: ctx.guildId, payload });
    await enqueueJob(tx, { type: 'status.maintenance.start', dedupeKey: keys.start, runAt: w.startsAt, guildId: ctx.guildId, payload });
    await enqueueJob(tx, { type: 'status.maintenance.end', dedupeKey: keys.end, runAt: w.endsAt, guildId: ctx.guildId, payload });
    await audit(ctx, { action: 'status.maintenance.create', targetType: 'MaintenanceWindow', targetId: w.id, metadata: { startsAt: w.startsAt.toISOString(), endsAt: w.endsAt.toISOString(), services: ids.length } }, tx);
    return w;
  });
}

async function loadWindow(ctx: Ctx, id: string) {
  const w = await ctx.db.maintenanceWindow.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!w) throw notFound('Maintenance window');
  return w;
}

/**
 * Edit / reschedule. Scheduled windows can change everything; an in-progress
 * window can only extend/shorten its end. Pending jobs are moved, and members
 * get a fresh announcement when the times change.
 */
export async function updateMaintenance(ctx: Ctx, id: string, raw: z.input<typeof updateMaintenanceSchema>): Promise<MaintenanceWindow> {
  await requireModule(ctx, 'status');
  await requirePermission(ctx, 'incidents.manage', 'status.maintenance.update');
  const input = updateMaintenanceSchema.parse(raw);
  const w = await loadWindow(ctx, id);
  if (w.status === 'COMPLETED' || w.status === 'CANCELLED') throw invalidState('This maintenance window is already closed.');
  if (w.status === 'IN_PROGRESS' && (input.startsAt || input.serviceSlugs)) {
    throw invalidState('Maintenance already started: only the end time and text can be changed.');
  }
  const startsAt = input.startsAt ?? w.startsAt;
  const endsAt = input.endsAt ?? w.endsAt;
  const now = ctx.now();
  validateWindow(startsAt, endsAt, now, false);
  const timesChanged = startsAt.getTime() !== w.startsAt.getTime() || endsAt.getTime() !== w.endsAt.getTime();

  return ctx.db.$transaction(async (tx) => {
    const ids = input.serviceSlugs ? await serviceIdsFor(tx, ctx.guildId, input.serviceSlugs) : undefined;
    const updated = await tx.maintenanceWindow.update({
      where: { id },
      data: {
        title: input.title ? clean(input.title) : undefined,
        description: input.description ? clean(input.description) : undefined,
        startsAt,
        endsAt,
        services: ids ? { set: ids.map((i) => ({ id: i })) } : undefined,
      },
    });
    const keys = maintenanceJobKeys(id);
    if (timesChanged) {
      await rescheduleJob(tx, keys.start, startsAt);
      await rescheduleJob(tx, keys.end, endsAt);
      if (w.announcedAt) {
        await enqueueJob(tx, {
          type: 'status.maintenance.announce',
          dedupeKey: `${keys.announce}:${startsAt.getTime()}:${endsAt.getTime()}`,
          runAt: now,
          guildId: ctx.guildId,
          payload: { windowId: id, rescheduled: true },
        });
      }
    }
    await audit(ctx, { action: 'status.maintenance.update', targetType: 'MaintenanceWindow', targetId: id, metadata: { fields: Object.keys(input), timesChanged } }, tx);
    return updated;
  });
}

/** Cancel a scheduled window: its pending jobs are cancelled. In-progress windows are ended early instead. */
export async function cancelMaintenance(ctx: Ctx, id: string): Promise<MaintenanceWindow> {
  await requireModule(ctx, 'status');
  await requirePermission(ctx, 'incidents.manage', 'status.maintenance.cancel');
  const w = await loadWindow(ctx, id);
  if (w.status !== 'SCHEDULED') {
    throw invalidState(w.status === 'IN_PROGRESS' ? 'This maintenance is in progress — end it early instead.' : 'This maintenance window is already closed.');
  }
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.maintenanceWindow.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    if (res.count === 0) throw invalidState('This maintenance window changed state; please refresh.');
    const keys = maintenanceJobKeys(id);
    await cancelJob(tx, keys.announce);
    await cancelJob(tx, keys.start);
    await cancelJob(tx, keys.end);
    if (w.announcedAt) {
      await enqueueJob(tx, { type: 'status.maintenance.cancelled', dedupeKey: keys.cancelled, runAt: ctx.now(), guildId: ctx.guildId, payload: { windowId: id } });
    }
    await audit(ctx, { action: 'status.maintenance.cancel', targetType: 'MaintenanceWindow', targetId: id }, tx);
    return tx.maintenanceWindow.findUniqueOrThrow({ where: { id } });
  });
}

/** End an in-progress window now (moves its end job to now). */
export async function endMaintenanceNow(ctx: Ctx, id: string): Promise<MaintenanceWindow> {
  await requireModule(ctx, 'status');
  await requirePermission(ctx, 'incidents.manage', 'status.maintenance.end');
  const w = await loadWindow(ctx, id);
  if (w.status !== 'IN_PROGRESS') throw invalidState('Only in-progress maintenance can be ended early.');
  const now = ctx.now();
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.maintenanceWindow.update({ where: { id }, data: { endsAt: now } });
    const key = maintenanceJobKeys(id).end;
    const moved = await rescheduleJob(tx, key, now);
    if (!moved) await enqueueJob(tx, { type: 'status.maintenance.end', dedupeKey: `${key}:early`, runAt: now, guildId: ctx.guildId, payload: { windowId: id } });
    await audit(ctx, { action: 'status.maintenance.end_early', targetType: 'MaintenanceWindow', targetId: id }, tx);
    return updated;
  });
}

export const listMaintenanceSchema = paginationSchema.extend({
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
});

export async function listMaintenance(ctx: Ctx, raw: z.input<typeof listMaintenanceSchema> = {}): Promise<Page<MaintenanceWindow & { services: Array<{ id: string; slug: string; name: string }> }>> {
  await requireAny(ctx, ['incidents.view', 'incidents.manage'], 'status.maintenance.list');
  const q = listMaintenanceSchema.parse(raw);
  const rows = await ctx.db.maintenanceWindow.findMany({
    where: { guildId: ctx.guildId, status: q.status },
    include: { services: { select: { id: true, slug: true, name: true } } },
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(q),
  });
  return toPage(rows, q.limit);
}

/** IDs of services covered by an in-progress window (monitor suppresses alerts for them). */
export async function servicesInMaintenance(db: Db, guildId: string): Promise<Set<string>> {
  const rows = await db.maintenanceWindow.findMany({
    where: { guildId, status: 'IN_PROGRESS' },
    select: { services: { select: { id: true } } },
  });
  return new Set(rows.flatMap((r) => r.services.map((s) => s.id)));
}

// ── Lifecycle (driven by worker jobs) ────────────────────────────────────────

const withServices = { services: { select: { id: true, slug: true, name: true, public: true } } } as const;
export type WindowWithServices = Prisma.MaintenanceWindowGetPayload<{ include: typeof withServices }>;

const sysAudit = async (tx: Prisma.TransactionClient, guildId: string, action: string, targetId: string) =>
  tx.securityAuditEvent.create({
    data: { guildId, actorId: 'system', actorType: 'SYSTEM', source: 'worker', action, targetType: 'MaintenanceWindow', targetId, result: 'SUCCESS', metadata: {} },
  });

/**
 * Start a scheduled window (idempotent): status → IN_PROGRESS and covered
 * services → MAINTENANCE. Returns the window while it is in progress, or null
 * if it was cancelled / is not due (stale job after a reschedule).
 */
export async function beginMaintenance(db: Ctx['db'], windowId: string, now: Date): Promise<WindowWithServices | null> {
  const w = await db.maintenanceWindow.findUnique({ where: { id: windowId }, include: withServices });
  if (!w) return null;
  if (w.status === 'IN_PROGRESS') return w;
  if (w.status !== 'SCHEDULED' || w.startsAt.getTime() > now.getTime() + 1000) return null;
  return db.$transaction(async (tx) => {
    const res = await tx.maintenanceWindow.updateMany({ where: { id: windowId, status: 'SCHEDULED' }, data: { status: 'IN_PROGRESS' } });
    if (res.count === 0) return tx.maintenanceWindow.findUnique({ where: { id: windowId }, include: withServices }).then((x) => (x?.status === 'IN_PROGRESS' ? x : null));
    await tx.monitoredService.updateMany({
      where: { id: { in: w.services.map((s) => s.id) }, state: { not: 'MAINTENANCE' } },
      data: { state: 'MAINTENANCE', lastStateChangeAt: now },
    });
    await sysAudit(tx, w.guildId, 'status.maintenance.start', w.id);
    return tx.maintenanceWindow.findUniqueOrThrow({ where: { id: windowId }, include: withServices });
  });
}

/**
 * Complete a window (idempotent). Covered services not under another active
 * window go back to UNKNOWN with fresh counters, so the next check sets their
 * real state. Returns the window and whether an "ended" notice should be posted.
 */
export async function finishMaintenance(db: Ctx['db'], windowId: string, now: Date): Promise<{ window: WindowWithServices; notify: boolean } | null> {
  const w = await db.maintenanceWindow.findUnique({ where: { id: windowId }, include: withServices });
  if (!w || w.status === 'CANCELLED') return null;
  if (w.status === 'COMPLETED') return { window: w, notify: !w.endNotifiedAt && !!w.startNotifiedAt };
  if (w.endsAt.getTime() > now.getTime() + 1000) return null; // stale job: the window was extended
  const wasRunning = w.status === 'IN_PROGRESS';
  return db.$transaction(async (tx) => {
    const res = await tx.maintenanceWindow.updateMany({ where: { id: windowId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } }, data: { status: 'COMPLETED' } });
    if (res.count === 0) return null;
    const stillCovered = await tx.maintenanceWindow.findMany({
      where: { guildId: w.guildId, status: 'IN_PROGRESS', id: { not: w.id } },
      select: { services: { select: { id: true } } },
    });
    const covered = new Set(stillCovered.flatMap((x) => x.services.map((s) => s.id)));
    const restore = w.services.map((s) => s.id).filter((id) => !covered.has(id));
    await tx.monitoredService.updateMany({
      where: { id: { in: restore }, state: 'MAINTENANCE' },
      data: { state: 'UNKNOWN', consecutiveFailures: 0, consecutiveSuccesses: 0, lastStateChangeAt: now },
    });
    await sysAudit(tx, w.guildId, 'status.maintenance.complete', w.id);
    const window = await tx.maintenanceWindow.findUniqueOrThrow({ where: { id: windowId }, include: withServices });
    return { window, notify: wasRunning && !window.endNotifiedAt };
  });
}
