import { z } from 'zod';
import type { IncidentSeverity, StatusSubscription } from '@gynx/database';
import { conflict, notFound } from '@gynx/shared';
import { requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { INCIDENT_SEVERITIES, severitiesAtOrBelow } from './incidents';
import { StatusText } from './texts';

export const ALL_SERVICES = '*';
const MAX_SUBSCRIPTIONS_PER_MEMBER = 25;

/** Accepts 'all' / '*' or a service slug. */
const serviceRef = z
  .string()
  .trim()
  .toLowerCase()
  .max(40)
  .transform((s) => (s === 'all' || s === '*' || s === '' ? ALL_SERVICES : s));

export const subscribeSchema = z.object({
  service: serviceRef.default(ALL_SERVICES),
  minSeverity: z.enum(INCIDENT_SEVERITIES).default('MINOR'),
  maintenance: z.boolean().default(true),
});
export type SubscribeInput = z.input<typeof subscribeSchema>;

/** Subscribe (or update an existing subscription of) the invoking member. */
export async function subscribe(ctx: Ctx, raw: SubscribeInput): Promise<StatusSubscription> {
  await requireModule(ctx, 'status');
  const input = subscribeSchema.parse(raw);
  await requireRate(ctx, 'status.subscribe', 10, 3600);
  if (input.service !== ALL_SERVICES) {
    const svc = await ctx.db.monitoredService.findFirst({
      where: { guildId: ctx.guildId, slug: input.service, public: true },
      select: { id: true },
    });
    if (!svc) throw notFound('Service');
  }
  const key = {
    guildId_userId_serviceSlug: {
      guildId: ctx.guildId,
      userId: ctx.actor.userId,
      serviceSlug: input.service,
    },
  };
  const existing = await ctx.db.statusSubscription.findUnique({ where: key });
  if (!existing) {
    const count = await ctx.db.statusSubscription.count({
      where: { guildId: ctx.guildId, userId: ctx.actor.userId },
    });
    if (count >= MAX_SUBSCRIPTIONS_PER_MEMBER) throw conflict(StatusText.subscriptionLimit());
  }
  return ctx.db.statusSubscription.upsert({
    where: key,
    create: {
      guildId: ctx.guildId,
      userId: ctx.actor.userId,
      serviceSlug: input.service,
      minSeverity: input.minSeverity,
      maintenance: input.maintenance,
    },
    update: { minSeverity: input.minSeverity, maintenance: input.maintenance },
  });
}

/** Remove the member's subscription for a service ('all' removes the '*' subscription; 'everything' removes all). */
export async function unsubscribe(ctx: Ctx, service: string): Promise<number> {
  await requireModule(ctx, 'status');
  await requireRate(ctx, 'status.subscribe', 10, 3600);
  const ref = z.string().trim().toLowerCase().max(40).parse(service);
  const where =
    ref === 'everything'
      ? { guildId: ctx.guildId, userId: ctx.actor.userId }
      : { guildId: ctx.guildId, userId: ctx.actor.userId, serviceSlug: serviceRef.parse(ref) };
  const res = await ctx.db.statusSubscription.deleteMany({ where });
  return res.count;
}

export async function listMySubscriptions(ctx: Ctx): Promise<StatusSubscription[]> {
  await requireModule(ctx, 'status');
  return ctx.db.statusSubscription.findMany({
    where: { guildId: ctx.guildId, userId: ctx.actor.userId },
    orderBy: { serviceSlug: 'asc' },
  });
}

/**
 * Recipients for an incident: subscribed to '*' or to an affected (public)
 * service slug, with minSeverity ≤ incident severity. One row per user, ordered
 * by userId for cursor-based chunking.
 */
export async function incidentRecipients(
  db: Ctx['db'],
  guildId: string,
  opts: { severity: IncidentSeverity; slugs: string[]; afterUserId?: string; limit: number },
): Promise<string[]> {
  const rows = await db.statusSubscription.findMany({
    where: {
      guildId,
      serviceSlug: { in: [ALL_SERVICES, ...opts.slugs] },
      minSeverity: { in: severitiesAtOrBelow(opts.severity) },
      ...(opts.afterUserId ? { userId: { gt: opts.afterUserId } } : {}),
    },
    distinct: ['userId'],
    orderBy: { userId: 'asc' },
    select: { userId: true },
    take: opts.limit,
  });
  return rows.map((r) => r.userId);
}

export async function maintenanceRecipients(
  db: Ctx['db'],
  guildId: string,
  opts: { slugs: string[]; afterUserId?: string; limit: number },
): Promise<string[]> {
  const rows = await db.statusSubscription.findMany({
    where: {
      guildId,
      maintenance: true,
      serviceSlug: { in: [ALL_SERVICES, ...opts.slugs] },
      ...(opts.afterUserId ? { userId: { gt: opts.afterUserId } } : {}),
    },
    distinct: ['userId'],
    orderBy: { userId: 'asc' },
    select: { userId: true },
    take: opts.limit,
  });
  return rows.map((r) => r.userId);
}
