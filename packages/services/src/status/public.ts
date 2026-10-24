import { z } from 'zod';
import type {
  Db,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentUpdate,
  MaintenanceStatus,
  MonitoredService,
  ServiceState,
} from '@gynx/database';
import { cursorArgs, notFound, paginationSchema, toPage, type Page } from '@gynx/shared';
import { STATE_RANK } from './state-machine';

/**
 * Public (member-facing) projections. Every object here is built by picking
 * explicit fields — target, port, allowPrivate, errorClass, thresholds and
 * staff IDs are never included.
 */

export interface PublicService {
  slug: string;
  name: string;
  region: string | null;
  description: string | null;
  state: ServiceState;
  lastCheckedAt: Date | null;
  lastStateChangeAt: Date | null;
}

export interface PublicIncidentUpdate {
  status: IncidentStatus;
  message: string;
  createdAt: Date;
}

export interface PublicIncident {
  id: string;
  ref: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  regions: string[];
  services: Array<{ slug: string; name: string }>;
  startedAt: Date;
  resolvedAt: Date | null;
  resolutionSummary: string | null;
  updatedAt: Date;
  updates: PublicIncidentUpdate[];
}

export interface PublicMaintenance {
  id: string;
  title: string;
  description: string;
  status: MaintenanceStatus;
  startsAt: Date;
  endsAt: Date;
  services: Array<{ slug: string; name: string }>;
}

export type OverallState = ServiceState | 'NO_SERVICES';

export interface PublicStatus {
  overall: OverallState;
  services: PublicService[];
  activeIncidents: PublicIncident[];
  upcomingMaintenance: PublicMaintenance[];
  generatedAt: Date;
}

type ServiceLike = Pick<
  MonitoredService,
  'slug' | 'name' | 'region' | 'description' | 'state' | 'lastCheckedAt' | 'lastStateChangeAt'
>;
type RefLike = Pick<MonitoredService, 'slug' | 'name' | 'public'>;

export function toPublicService(s: ServiceLike): PublicService {
  return {
    slug: s.slug,
    name: s.name,
    region: s.region,
    description: s.description,
    state: s.state,
    lastCheckedAt: s.lastCheckedAt,
    lastStateChangeAt: s.lastStateChangeAt,
  };
}

const publicRefs = (services: RefLike[]) =>
  services.filter((s) => s.public).map((s) => ({ slug: s.slug, name: s.name }));

export function toPublicIncident(
  i: Incident & { services: RefLike[]; updates?: IncidentUpdate[] },
): PublicIncident {
  return {
    id: i.id,
    ref: i.ref,
    title: i.title,
    description: i.description,
    severity: i.severity,
    status: i.status,
    regions: i.regions,
    services: publicRefs(i.services),
    startedAt: i.startedAt,
    resolvedAt: i.resolvedAt,
    resolutionSummary: i.resolutionSummary,
    updatedAt: i.updatedAt,
    updates: (i.updates ?? []).map((u) => ({ status: u.status, message: u.message, createdAt: u.createdAt })),
  };
}

export function toPublicMaintenance(m: {
  id: string;
  title: string;
  description: string;
  status: MaintenanceStatus;
  startsAt: Date;
  endsAt: Date;
  services: RefLike[];
}): PublicMaintenance {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    status: m.status,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    services: publicRefs(m.services),
  };
}

/** Worst state wins; UNKNOWN only when nothing is known. */
export function overallState(states: ServiceState[]): OverallState {
  if (states.length === 0) return 'NO_SERVICES';
  const known = states.filter((s) => s !== 'UNKNOWN');
  if (known.length === 0) return 'UNKNOWN';
  return known.reduce(
    (worst, s) => (STATE_RANK[s] > STATE_RANK[worst] ? s : worst),
    'OPERATIONAL' as ServiceState,
  );
}

const refSelect = { select: { slug: true, name: true, public: true } } as const;
const ACTIVE: IncidentStatus[] = ['INVESTIGATING', 'IDENTIFIED', 'MONITORING'];

export async function listPublicServices(db: Db, guildId: string): Promise<PublicService[]> {
  const rows = await db.monitoredService.findMany({
    where: { guildId, public: true, enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return rows.map(toPublicService);
}

/** Autocomplete helper over public services. */
export async function searchPublicServices(
  db: Db,
  guildId: string,
  query: string,
  limit = 25,
): Promise<Array<{ slug: string; name: string }>> {
  const q = query.trim().slice(0, 50);
  const rows = await db.monitoredService.findMany({
    where: {
      guildId,
      public: true,
      enabled: true,
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q.toLowerCase() } }] }
        : {}),
    },
    select: { slug: true, name: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: limit,
  });
  return rows;
}

export async function listActiveIncidents(db: Db, guildId: string, limit = 10): Promise<PublicIncident[]> {
  const rows = await db.incident.findMany({
    where: { guildId, status: { in: ACTIVE } },
    include: { services: refSelect, updates: { orderBy: { createdAt: 'desc' }, take: 3 } },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return rows.map(toPublicIncident);
}

export const incidentHistorySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(25).default(5),
  status: z.enum(['active', 'resolved', 'all']).default('resolved'),
});

/** Public, paginated incident history (newest first). */
export async function getIncidentHistory(
  db: Db,
  guildId: string,
  raw: z.input<typeof incidentHistorySchema> = {},
): Promise<Page<PublicIncident>> {
  const q = incidentHistorySchema.parse(raw);
  const rows = await db.incident.findMany({
    where: {
      guildId,
      ...(q.status === 'resolved'
        ? { status: 'RESOLVED' as const }
        : q.status === 'active'
          ? { status: { in: ACTIVE } }
          : {}),
    },
    include: { services: refSelect, updates: { orderBy: { createdAt: 'desc' }, take: 1 } },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(q),
  });
  const page = toPage(rows, q.limit);
  return { items: page.items.map(toPublicIncident), nextCursor: page.nextCursor };
}

/** Public detail of one incident by ref (e.g. INC-0003). */
export async function getPublicIncident(db: Db, guildId: string, ref: string): Promise<PublicIncident> {
  const i = await db.incident.findFirst({
    where: { guildId, ref: ref.trim().toUpperCase() },
    include: { services: refSelect, updates: { orderBy: { createdAt: 'desc' } } },
  });
  if (!i) throw notFound('Incident');
  return toPublicIncident(i);
}

export async function listUpcomingMaintenance(
  db: Db,
  guildId: string,
  now: Date,
  limit = 5,
): Promise<PublicMaintenance[]> {
  const rows = await db.maintenanceWindow.findMany({
    where: { guildId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, endsAt: { gt: now } },
    include: { services: refSelect },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  return rows.map(toPublicMaintenance);
}

/** Everything a member may see on the status page. */
export async function getPublicStatus(
  db: Db,
  guildId: string,
  now: Date = new Date(),
): Promise<PublicStatus> {
  const [services, activeIncidents, upcomingMaintenance] = await Promise.all([
    listPublicServices(db, guildId),
    listActiveIncidents(db, guildId),
    listUpcomingMaintenance(db, guildId, now),
  ]);
  return {
    overall: overallState(services.map((s) => s.state)),
    services,
    activeIncidents,
    upcomingMaintenance,
    generatedAt: now,
  };
}

// ── Uptime ────────────────────────────────────────────────────────────────────

export const UPTIME_PERIODS = [1, 7, 30, 90] as const;
export type UptimePeriod = (typeof UPTIME_PERIODS)[number];

export interface UptimeRow {
  slug: string;
  name: string;
  days: UptimePeriod;
  totalChecks: number;
  okChecks: number;
  /** null when there is no data — never invented. */
  uptimePct: number | null;
  label: string;
}

/** uptime % = ok checks / total checks, floored to 2 decimals so 99.996% never shows as 100%. */
export function computeUptime(
  okChecks: number,
  totalChecks: number,
): { uptimePct: number | null; label: string } {
  if (totalChecks <= 0) return { uptimePct: null, label: 'no data' };
  const pct = Math.floor((Math.min(okChecks, totalChecks) / totalChecks) * 10_000) / 100;
  return { uptimePct: pct, label: `${pct.toFixed(2)}%` };
}

export const uptimeQuerySchema = z.object({
  slug: z.string().trim().toLowerCase().max(40).optional(),
  days: z.coerce
    .number()
    .int()
    .refine(
      (d): d is UptimePeriod => (UPTIME_PERIODS as readonly number[]).includes(d),
      'Period must be 1, 7, 30 or 90 days.',
    )
    .default(30),
});

/** Uptime per public service over the period, computed from stored HealthCheck rows. */
export async function getUptime(
  db: Db,
  guildId: string,
  raw: z.input<typeof uptimeQuerySchema> = {},
  now: Date = new Date(),
): Promise<UptimeRow[]> {
  const q = uptimeQuerySchema.parse(raw);
  const days = q.days as UptimePeriod;
  const services = await db.monitoredService.findMany({
    where: { guildId, public: true, enabled: true, ...(q.slug ? { slug: q.slug } : {}) },
    select: { id: true, slug: true, name: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  if (q.slug && services.length === 0) throw notFound('Service');
  if (services.length === 0) return [];

  const since = new Date(now.getTime() - days * 86_400_000);
  const grouped = await db.healthCheck.groupBy({
    by: ['serviceId', 'ok'],
    where: { serviceId: { in: services.map((s) => s.id) }, checkedAt: { gte: since, lte: now } },
    _count: { _all: true },
  });
  return services.map((s) => {
    let total = 0;
    let ok = 0;
    for (const g of grouped) {
      if (g.serviceId !== s.id) continue;
      total += g._count._all;
      if (g.ok) ok += g._count._all;
    }
    return {
      slug: s.slug,
      name: s.name,
      days,
      totalChecks: total,
      okChecks: ok,
      ...computeUptime(ok, total),
    };
  });
}
