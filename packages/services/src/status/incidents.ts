import { z } from 'zod';
import {
  nextSequence,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentUpdate,
  type Prisma,
} from '@gynx/database';
import {
  cursorArgs,
  formatRef,
  invalidState,
  neutraliseMentions,
  notFound,
  paginationSchema,
  redactSecrets,
  toPage,
  validation,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { requireAny, requirePermission } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { enqueueJob } from '../core/jobs';

export const INCIDENT_SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
export const INCIDENT_STATUSES = ['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'] as const;
export const SEVERITY_RANK: Record<IncidentSeverity, number> = { MINOR: 0, MAJOR: 1, CRITICAL: 2 };
export const ACTIVE_INCIDENT_STATUSES: IncidentStatus[] = ['INVESTIGATING', 'IDENTIFIED', 'MONITORING'];

/** Severities at or below `s` — i.e. the subscription minSeverity values that should receive `s`. */
export function severitiesAtOrBelow(s: IncidentSeverity): IncidentSeverity[] {
  return INCIDENT_SEVERITIES.filter((x) => SEVERITY_RANK[x] <= SEVERITY_RANK[s]);
}

/**
 * Lifecycle INVESTIGATING → IDENTIFIED → MONITORING → RESOLVED. Any open status
 * may move to any other status (skip forward, or regress if the issue
 * recurs); RESOLVED is terminal.
 */
export function canTransitionIncident(from: IncidentStatus, to: IncidentStatus): boolean {
  return from !== 'RESOLVED' && (INCIDENT_STATUSES as readonly string[]).includes(to);
}

/** Free text shown publicly: strip mass mentions and anything secret-shaped (incl. IPs). */
const clean = (s: string) => neutraliseMentions(redactSecrets(s.trim()));

const slugList = z.array(z.string().trim().toLowerCase().max(40)).max(25).default([]);

export const createIncidentSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(2000),
  severity: z.enum(INCIDENT_SEVERITIES),
  status: z.enum(['INVESTIGATING', 'IDENTIFIED', 'MONITORING']).default('INVESTIGATING'),
  serviceSlugs: slugList,
  regions: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});
export type CreateIncidentInput = z.input<typeof createIncidentSchema>;

export const incidentUpdateSchema = z.object({
  status: z.enum(INCIDENT_STATUSES),
  message: z.string().trim().min(3).max(2000),
  resolutionSummary: z.string().trim().min(3).max(2000).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
});
export type IncidentUpdateInput = z.input<typeof incidentUpdateSchema>;

async function resolveServiceIds(
  tx: Prisma.TransactionClient,
  guildId: string,
  slugs: string[],
): Promise<string[]> {
  if (slugs.length === 0) return [];
  const unique = [...new Set(slugs)];
  const rows = await tx.monitoredService.findMany({
    where: { guildId, slug: { in: unique } },
    select: { id: true, slug: true },
  });
  const missing = unique.filter((s) => !rows.some((r) => r.slug === s));
  if (missing.length) throw validation(`Unknown service(s): ${missing.join(', ')}`);
  return rows.map((r) => r.id);
}

export async function enqueueIncidentNotify(
  tx: Prisma.TransactionClient,
  guildId: string,
  incidentId: string,
  updateId: string,
  runAt: Date,
) {
  await enqueueJob(tx, {
    type: 'status.incident.notify',
    dedupeKey: `status.incident.notify:${updateId}`,
    runAt,
    guildId,
    payload: { incidentId, updateId },
  });
}

interface CreateIncidentData {
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  serviceIds: string[];
  regions: string[];
  autoCreated: boolean;
}

/** Shared by staff creation and the monitor's automatic incidents. Caller owns the transaction. */
export async function createIncidentTx(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  d: CreateIncidentData,
): Promise<{ incident: Incident; update: IncidentUpdate }> {
  const number = await nextSequence(tx, ctx.guildId, 'incident');
  const now = ctx.now();
  const incident = await tx.incident.create({
    data: {
      guildId: ctx.guildId,
      number,
      ref: formatRef('INC', number),
      title: d.title,
      description: d.description,
      severity: d.severity,
      status: d.status,
      regions: d.regions,
      autoCreated: d.autoCreated,
      createdById: ctx.actor.userId,
      startedAt: now,
      services: { connect: d.serviceIds.map((id) => ({ id })) },
    },
  });
  const update = await tx.incidentUpdate.create({
    data: {
      incidentId: incident.id,
      status: d.status,
      message: d.description,
      authorId: ctx.actor.userId,
      createdAt: now,
    },
  });
  await audit(
    ctx,
    {
      action: 'status.incident.create',
      targetType: 'Incident',
      targetId: incident.id,
      metadata: {
        ref: incident.ref,
        severity: d.severity,
        status: d.status,
        autoCreated: d.autoCreated,
        services: d.serviceIds.length,
      },
    },
    tx,
  );
  await enqueueIncidentNotify(tx, ctx.guildId, incident.id, update.id, now);
  return { incident, update };
}

/** Shared by staff updates and the monitor's automatic recovery update. */
export async function addIncidentUpdateTx(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  incident: Incident,
  d: {
    status: IncidentStatus;
    message: string;
    resolutionSummary?: string | null;
    severity?: IncidentSeverity;
  },
): Promise<{ incident: Incident; update: IncidentUpdate }> {
  if (!canTransitionIncident(incident.status, d.status))
    throw invalidState('This incident is resolved and can no longer be updated.');
  if (d.status === 'RESOLVED' && !d.resolutionSummary)
    throw validation('A resolution summary is required to resolve an incident.');
  const now = ctx.now();
  // Conditional update: a concurrent resolve can't be overwritten.
  const res = await tx.incident.updateMany({
    where: { id: incident.id, status: { not: 'RESOLVED' } },
    data: {
      status: d.status,
      severity: d.severity ?? incident.severity,
      ...(d.status === 'RESOLVED' ? { resolvedAt: now, resolutionSummary: d.resolutionSummary ?? null } : {}),
    },
  });
  if (res.count === 0) throw invalidState('This incident is resolved and can no longer be updated.');
  const update = await tx.incidentUpdate.create({
    data: {
      incidentId: incident.id,
      status: d.status,
      message: d.message,
      authorId: ctx.actor.userId,
      createdAt: now,
    },
  });
  await audit(
    ctx,
    {
      action: 'status.incident.update',
      targetType: 'Incident',
      targetId: incident.id,
      metadata: {
        ref: incident.ref,
        from: incident.status,
        to: d.status,
        severity: d.severity ?? incident.severity,
      },
    },
    tx,
  );
  await enqueueIncidentNotify(tx, ctx.guildId, incident.id, update.id, now);
  return { incident: await tx.incident.findUniqueOrThrow({ where: { id: incident.id } }), update };
}

export async function createIncident(ctx: Ctx, raw: CreateIncidentInput): Promise<Incident> {
  await requireModule(ctx, 'status');
  await requirePermission(ctx, 'incidents.manage', 'status.incident.create');
  const input = createIncidentSchema.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const serviceIds = await resolveServiceIds(tx, ctx.guildId, input.serviceSlugs);
    const { incident } = await createIncidentTx(tx, ctx, {
      title: clean(input.title),
      description: clean(input.description),
      severity: input.severity,
      status: input.status,
      serviceIds,
      regions: input.regions.map(clean),
      autoCreated: false,
    });
    return incident;
  });
}

export async function addIncidentUpdate(ctx: Ctx, incidentId: string, raw: IncidentUpdateInput) {
  await requireModule(ctx, 'status');
  await requirePermission(ctx, 'incidents.manage', 'status.incident.update');
  const input = incidentUpdateSchema.parse(raw);
  const incident = await ctx.db.incident.findFirst({ where: { id: incidentId, guildId: ctx.guildId } });
  if (!incident) throw notFound('Incident');
  return ctx.db.$transaction((tx) =>
    addIncidentUpdateTx(tx, ctx, incident, {
      status: input.status,
      message: clean(input.message),
      resolutionSummary: input.resolutionSummary ? clean(input.resolutionSummary) : null,
      severity: input.severity,
    }),
  );
}

export const editIncidentSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  serviceSlugs: slugList.optional(),
  regions: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
});

/** Edit metadata (title / affected services / regions) without posting a status update. */
export async function editIncident(
  ctx: Ctx,
  incidentId: string,
  raw: z.input<typeof editIncidentSchema>,
): Promise<Incident> {
  await requirePermission(ctx, 'incidents.manage', 'status.incident.edit');
  const input = editIncidentSchema.parse(raw);
  const incident = await ctx.db.incident.findFirst({ where: { id: incidentId, guildId: ctx.guildId } });
  if (!incident) throw notFound('Incident');
  return ctx.db.$transaction(async (tx) => {
    const serviceIds = input.serviceSlugs
      ? await resolveServiceIds(tx, ctx.guildId, input.serviceSlugs)
      : undefined;
    const updated = await tx.incident.update({
      where: { id: incidentId },
      data: {
        title: input.title ? clean(input.title) : undefined,
        regions: input.regions?.map(clean),
        services: serviceIds ? { set: serviceIds.map((id) => ({ id })) } : undefined,
      },
    });
    await audit(
      ctx,
      {
        action: 'status.incident.edit',
        targetType: 'Incident',
        targetId: incidentId,
        metadata: { ref: incident.ref, fields: Object.keys(input) },
      },
      tx,
    );
    return updated;
  });
}

export const staffIncidentListSchema = paginationSchema.extend({
  status: z.enum(INCIDENT_STATUSES).optional(),
  active: z.boolean().optional(),
});

/** Staff list with full rows (includes createdById/message IDs). */
export async function listIncidents(
  ctx: Ctx,
  raw: z.input<typeof staffIncidentListSchema> = {},
): Promise<Page<Incident & { services: Array<{ id: string; slug: string; name: string }> }>> {
  await requireAny(ctx, ['incidents.view', 'incidents.manage'], 'status.incident.list');
  const q = staffIncidentListSchema.parse(raw);
  const rows = await ctx.db.incident.findMany({
    where: {
      guildId: ctx.guildId,
      status: q.status ?? (q.active ? { in: ACTIVE_INCIDENT_STATUSES } : undefined),
    },
    include: { services: { select: { id: true, slug: true, name: true } } },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(q),
  });
  return toPage(rows, q.limit);
}

export async function getIncident(ctx: Ctx, id: string) {
  await requireAny(ctx, ['incidents.view', 'incidents.manage'], 'status.incident.view');
  const i = await ctx.db.incident.findFirst({
    where: { id, guildId: ctx.guildId },
    include: {
      services: { select: { id: true, slug: true, name: true, public: true } },
      updates: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!i) throw notFound('Incident');
  return i;
}
