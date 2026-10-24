import 'server-only';
import type { SecurityAuditEvent } from '@gynx/database';
import { can, type Ctx } from '@gynx/services';

/**
 * Read-only counts for the overview page. Each card is gated by the
 * permission that would let the user see the underlying records; cards the
 * user may not see come back as `null` and are not rendered.
 */
export interface OverviewData {
  database: { ok: boolean };
  jobs: { pending: number; dead: number; failed: number; lastCompletedAt: Date | null } | null;
  member: { count: number; at: Date | null } | null;
  openReports: number | null;
  activeIncidents: number | null;
  scheduledAnnouncements: number | null;
  upcomingEvents: number | null;
  recentAudit: SecurityAuditEvent[] | null;
}

async function safe<T>(fn: () => Promise<T>, onError: T, ctx: Ctx, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    ctx.log.warn({ err: { message: (err as Error).message }, what }, 'overview query failed');
    return onError;
  }
}

export async function getOverview(ctx: Ctx): Promise<OverviewData> {
  const db = ctx.db;
  const guildId = ctx.guildId;
  const now = ctx.now();
  const jobScope = { OR: [{ guildId }, { guildId: null }] };

  const dbOk = await safe(() => db.$queryRaw`SELECT 1`.then(() => true), false, ctx, 'db.ping');
  if (!dbOk) {
    return {
      database: { ok: false },
      jobs: null,
      member: null,
      openReports: null,
      activeIncidents: null,
      scheduledAnnouncements: null,
      upcomingEvents: null,
      recentAudit: null,
    };
  }

  const [jobs, member, openReports, activeIncidents, scheduledAnnouncements, upcomingEvents, recentAudit] =
    await Promise.all([
      safe(
        async () => {
          const [pending, dead, failed, last] = await Promise.all([
            db.scheduledJob.count({ where: { ...jobScope, status: 'PENDING' } }),
            db.scheduledJob.count({ where: { ...jobScope, status: 'DEAD' } }),
            db.scheduledJob.count({ where: { ...jobScope, status: 'FAILED' } }),
            db.scheduledJob.findFirst({
              where: { status: 'DONE', completedAt: { not: null } },
              orderBy: { completedAt: 'desc' },
              select: { completedAt: true },
            }),
          ]);
          return { pending, dead, failed, lastCompletedAt: last?.completedAt ?? null };
        },
        null,
        ctx,
        'jobs',
      ),
      safe(
        async () => {
          const g = await db.guild.findUnique({
            where: { id: guildId },
            select: { memberCount: true, memberCountAt: true },
          });
          return g ? { count: g.memberCount, at: g.memberCountAt } : null;
        },
        null,
        ctx,
        'guild',
      ),
      can(ctx, 'security.reports.view')
        ? safe(
            () =>
              db.abuseReport.count({
                where: { guildId, status: { in: ['NEW', 'TRIAGED', 'INVESTIGATING'] } },
              }),
            null,
            ctx,
            'reports',
          )
        : Promise.resolve(null),
      can(ctx, 'incidents.view')
        ? safe(
            () => db.incident.count({ where: { guildId, status: { not: 'RESOLVED' } } }),
            null,
            ctx,
            'incidents',
          )
        : Promise.resolve(null),
      can(ctx, 'announcements.create') || can(ctx, 'announcements.publish')
        ? safe(
            () => db.announcement.count({ where: { guildId, status: 'SCHEDULED' } }),
            null,
            ctx,
            'announcements',
          )
        : Promise.resolve(null),
      can(ctx, 'events.manage')
        ? safe(
            () =>
              db.communityEvent.count({ where: { guildId, status: 'SCHEDULED', startsAt: { gte: now } } }),
            null,
            ctx,
            'events',
          )
        : Promise.resolve(null),
      can(ctx, 'audit.view')
        ? safe(
            () =>
              db.securityAuditEvent.findMany({
                where: { guildId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 8,
              }),
            null,
            ctx,
            'audit',
          )
        : Promise.resolve(null),
    ]);

  return {
    database: { ok: true },
    jobs,
    member,
    openReports,
    activeIncidents,
    scheduledAnnouncements,
    upcomingEvents,
    recentAudit,
  };
}
