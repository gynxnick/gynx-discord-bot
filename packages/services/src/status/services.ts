import { isIP } from 'node:net';
import { z } from 'zod';
import { isUniqueViolation, type MonitoredService, type Prisma, type ServiceState } from '@gynx/database';
import { conflict, isBlockedAddress, isValidHostname, notFound, validation } from '@gynx/shared';
import { audit } from '../core/audit';
import { requireAny, requirePermission } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { enqueueJob } from '../core/jobs';

export const SERVICE_KINDS = ['HTTP', 'TCP', 'STATUSPAGE', 'MANUAL'] as const;
export const SERVICE_STATES = ['OPERATIONAL', 'DEGRADED', 'OUTAGE', 'MAINTENANCE', 'UNKNOWN'] as const;
/** Slugs reserved for "all services" in subscriptions and pickers. */
const RESERVED_SLUGS = new Set(['all', '*', 'none']);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Slug must be 1–40 lowercase letters, digits or dashes.')
  .refine((s) => !RESERVED_SLUGS.has(s), 'That slug is reserved.');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const serviceFields = {
  name: z.string().trim().min(1).max(80),
  slug: slugSchema,
  region: optionalText(60),
  description: optionalText(300),
  kind: z.enum(SERVICE_KINDS).default('HTTP'),
  target: optionalText(500),
  port: z.coerce.number().int().min(1).max(65535).nullish(),
  expectedStatus: z.coerce.number().int().min(100).max(599).nullish(),
  timeoutMs: z.coerce.number().int().min(500).max(30_000).default(5000),
  degradedLatencyMs: z.coerce.number().int().min(1).max(60_000).nullish(),
  failureThreshold: z.coerce.number().int().min(1).max(20).nullish(),
  recoveryThreshold: z.coerce.number().int().min(1).max(20).nullish(),
  allowPrivate: z.boolean().default(false),
  enabled: z.boolean().default(true),
  public: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(-1000).max(1000).default(0),
};

export const createServiceSchema = z.object(serviceFields);
export const updateServiceSchema = z.object(serviceFields).partial();
export type CreateServiceInput = z.input<typeof createServiceSchema>;
export type UpdateServiceInput = z.input<typeof updateServiceSchema>;

type TargetShape = Pick<MonitoredService, 'kind' | 'target' | 'port' | 'allowPrivate'>;

function checkLiteralHost(host: string, allowPrivate: boolean) {
  const bare = host.replace(/^\[|\]$/g, '');
  if (!isValidHostname(bare)) throw validation('The target host is not a valid hostname or IP address.');
  if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$/i.test(bare) && !allowPrivate) {
    throw validation('Local/internal hostnames require "allow private" to be enabled.');
  }
  if (isIP(bare) && isBlockedAddress(bare) && !allowPrivate) {
    throw validation('Private, loopback and reserved addresses require "allow private" to be enabled.');
  }
}

/**
 * Validate the target for the check kind. Returns the normalised target/port.
 * DNS is NOT resolved here (it can change); every check re-validates and pins.
 */
export function validateTarget(s: TargetShape): { target: string | null; port: number | null } {
  switch (s.kind) {
    case 'MANUAL':
      return { target: null, port: null };
    case 'HTTP':
    case 'STATUSPAGE': {
      if (!s.target) throw validation('A URL is required for this check type.');
      let url: URL;
      try {
        url = new URL(s.target);
      } catch {
        throw validation('The target must be a valid http(s) URL.');
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw validation('Only http:// and https:// targets are supported.');
      if (url.username || url.password) throw validation('Do not put credentials in the target URL.');
      checkLiteralHost(url.hostname, s.allowPrivate);
      return { target: url.toString(), port: null };
    }
    case 'TCP': {
      if (!s.target) throw validation('A host is required for TCP checks.');
      if (!s.port) throw validation('A port (1–65535) is required for TCP checks.');
      const host = s.target.trim().toLowerCase();
      if (host.includes('/') || (host.includes(':') && !isIP(host.replace(/^\[|\]$/g, '')))) {
        throw validation('Enter only a hostname or IP for TCP checks (port goes in the port field).');
      }
      checkLiteralHost(host, s.allowPrivate);
      return { target: host, port: s.port };
    }
  }
}

/** Staff reads of monitoring internals (targets, error classes). */
async function requireStaffView(ctx: Ctx) {
  await requireAny(ctx, ['status.manage', 'incidents.view', 'incidents.manage'], 'status.service.view');
}

export async function listServices(ctx: Ctx): Promise<MonitoredService[]> {
  await requireStaffView(ctx);
  return ctx.db.monitoredService.findMany({
    where: { guildId: ctx.guildId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function getService(ctx: Ctx, id: string) {
  await requireStaffView(ctx);
  const s = await ctx.db.monitoredService.findFirst({
    where: { id, guildId: ctx.guildId },
    include: { checks: { orderBy: { checkedAt: 'desc' }, take: 50 } },
  });
  if (!s) throw notFound('Service');
  return s;
}

async function requirePrivateGrant(ctx: Ctx, action: string) {
  // Monitoring private infrastructure is an SSRF-relevant decision → needs settings.manage too.
  await requirePermission(ctx, 'settings.manage', action);
}

export async function createService(ctx: Ctx, raw: CreateServiceInput): Promise<MonitoredService> {
  await requireModule(ctx, 'status');
  await requirePermission(ctx, 'status.manage', 'status.service.create');
  const input = createServiceSchema.parse(raw);
  if (input.allowPrivate) await requirePrivateGrant(ctx, 'status.service.allow_private');
  const { target, port } = validateTarget({
    kind: input.kind,
    target: input.target,
    port: input.port ?? null,
    allowPrivate: input.allowPrivate,
  });

  try {
    return await ctx.db.$transaction(async (tx) => {
      const s = await tx.monitoredService.create({
        data: { ...input, guildId: ctx.guildId, target, port, expectedStatus: input.expectedStatus ?? null },
      });
      await audit(
        ctx,
        {
          action: 'status.service.create',
          targetType: 'MonitoredService',
          targetId: s.id,
          metadata: { slug: s.slug, kind: s.kind, allowPrivate: s.allowPrivate, public: s.public },
        },
        tx,
      );
      if (s.allowPrivate) {
        await audit(
          ctx,
          {
            action: 'status.service.allow_private',
            targetType: 'MonitoredService',
            targetId: s.id,
            metadata: { slug: s.slug, enabled: true },
          },
          tx,
        );
      }
      return s;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`A service with the slug "${input.slug}" already exists.`);
    throw e;
  }
}

export async function updateService(
  ctx: Ctx,
  id: string,
  raw: UpdateServiceInput,
): Promise<MonitoredService> {
  await requireModule(ctx, 'status');
  await requirePermission(ctx, 'status.manage', 'status.service.update');
  const input = updateServiceSchema.parse(raw);
  const existing = await ctx.db.monitoredService.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!existing) throw notFound('Service');

  const allowPrivate = input.allowPrivate ?? existing.allowPrivate;
  const privateChanged = allowPrivate !== existing.allowPrivate;
  if (privateChanged && allowPrivate) await requirePrivateGrant(ctx, 'status.service.allow_private');

  const merged: TargetShape = {
    kind: input.kind ?? existing.kind,
    target: input.target !== undefined ? input.target : existing.target,
    port: input.port !== undefined ? (input.port ?? null) : existing.port,
    allowPrivate,
  };
  const targetTouched =
    input.kind !== undefined || input.target !== undefined || input.port !== undefined || privateChanged;
  const { target, port } = targetTouched
    ? validateTarget(merged)
    : { target: existing.target, port: existing.port };
  // Changing what is monitored invalidates the current streaks.
  const resetCounters =
    targetTouched && (target !== existing.target || port !== existing.port || merged.kind !== existing.kind);

  const data: Prisma.MonitoredServiceUpdateInput = {
    ...input,
    target,
    port,
    allowPrivate,
    ...(resetCounters ? { consecutiveFailures: 0, consecutiveSuccesses: 0 } : {}),
  };
  try {
    return await ctx.db.$transaction(async (tx) => {
      const s = await tx.monitoredService.update({ where: { id }, data });
      const changed = Object.keys(input).filter((k) => k !== 'target'); // never echo targets into audit metadata
      await audit(
        ctx,
        {
          action: 'status.service.update',
          targetType: 'MonitoredService',
          targetId: id,
          metadata: { slug: s.slug, changed, targetChanged: target !== existing.target },
        },
        tx,
      );
      if (privateChanged) {
        await audit(
          ctx,
          {
            action: 'status.service.allow_private',
            targetType: 'MonitoredService',
            targetId: id,
            metadata: { slug: s.slug, enabled: allowPrivate },
          },
          tx,
        );
      }
      return s;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`A service with that slug already exists.`);
    throw e;
  }
}

export async function deleteService(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'status.manage', 'status.service.delete');
  const s = await ctx.db.monitoredService.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!s) throw notFound('Service');
  await ctx.db.$transaction(async (tx) => {
    await tx.monitoredService.delete({ where: { id } });
    await tx.statusSubscription.deleteMany({ where: { guildId: ctx.guildId, serviceSlug: s.slug } });
    await audit(
      ctx,
      {
        action: 'status.service.delete',
        targetType: 'MonitoredService',
        targetId: id,
        metadata: { slug: s.slug },
      },
      tx,
    );
  });
}

export const setStateSchema = z.object({ state: z.enum(['OPERATIONAL', 'DEGRADED', 'OUTAGE', 'UNKNOWN']) });

/**
 * Staff-set state for MANUAL services (status pages for things we can't probe).
 * Emits an alert like the monitor does.
 */
export async function setManualState(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof setStateSchema>,
): Promise<MonitoredService> {
  await requireModule(ctx, 'status');
  await requireAny(ctx, ['status.manage', 'incidents.manage'], 'status.service.set_state');
  const { state } = setStateSchema.parse(raw);
  const s = await ctx.db.monitoredService.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!s) throw notFound('Service');
  if (s.kind !== 'MANUAL')
    throw validation(
      'Only MANUAL services can have their state set by hand; monitored services follow their checks.',
    );
  if (s.state === state) return s;
  const now = ctx.now();
  return ctx.db.$transaction(async (tx) => {
    const alert = state !== 'UNKNOWN' && state !== (s.lastAlertState ?? 'OPERATIONAL');
    const updated = await tx.monitoredService.update({
      where: { id },
      data: {
        state,
        lastStateChangeAt: now,
        ...(alert ? { lastAlertAt: now, lastAlertState: state as ServiceState } : {}),
      },
    });
    await audit(
      ctx,
      {
        action: 'status.service.set_state',
        targetType: 'MonitoredService',
        targetId: id,
        metadata: { slug: s.slug, from: s.state, to: state },
      },
      tx,
    );
    if (alert) await enqueueAlert(tx, ctx.guildId, updated.id, state, s.state, now);
    return updated;
  });
}

export async function enqueueAlert(
  tx: Prisma.TransactionClient,
  guildId: string,
  serviceId: string,
  state: ServiceState,
  from: ServiceState,
  stateChangeAt: Date,
) {
  await enqueueJob(tx, {
    type: 'status.alert',
    dedupeKey: `status.alert:${serviceId}:${stateChangeAt.getTime()}`,
    runAt: stateChangeAt,
    guildId,
    payload: { serviceId, state, from, stateChangeAt: stateChangeAt.toISOString() },
  });
}
