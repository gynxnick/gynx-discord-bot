import type { Db, Prisma } from '@gynx/database';
import { dateKeyInZone, zonedToUtc } from '@gynx/shared';
import { liveTrackedLinkClicks } from './collect';
import { addDaysToKey } from './metrics';

/**
 * Daily rollup stored in AnalyticsDaily.metrics. Counters are recomputed from source
 * tables on every run (idempotent). Snapshot fields (member count, cumulative tracked
 * link clicks) describe the *end* of the day: they are refreshed only while the day is
 * still "today" in the guild timezone, and preserved afterwards so a late recompute of
 * yesterday never overwrites them with today's values.
 */
export interface DailyMetrics {
  version: 1;
  messages: number;
  activeUsers: number;
  activeChannels: number;
  joins: number;
  leaves: number;
  moderationActions: number;
  automodDetections: number;
  abuseReportsReceived: number;
  incidentsOpened: number;
  announcementsPublished: number;
  memberCount?: number;
  memberCountAt?: string;
  trackedLinkClicksTotal?: number;
  trackedLinkClicksAt?: string;
}

/** UTC bounds of a guild-local calendar day. */
export function dayBounds(dateKey: string, tz: string): { start: Date; end: Date } {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const next = addDaysToKey(dateKey, 1).split('-').map(Number) as [number, number, number];
  return { start: zonedToUtc(y, m, d, 0, 0, tz), end: zonedToUtc(next[0], next[1], next[2], 0, 0, tz) };
}

export async function computeDailyRollup(db: Db, guildId: string, dateKey: string, tz: string, now: Date): Promise<DailyMetrics> {
  const { start, end } = dayBounds(dateKey, tz);
  const at = { gte: start, lt: end };
  const isToday = dateKeyInZone(now, tz) === dateKey;
  const [messages, activeUsers, activeChannels, joins, leaves, moderationActions, automodDetections, abuseReportsReceived, incidentsOpened, announcementsPublished, existing, guild, hasLinks] =
    await Promise.all([
      db.channelActivityDaily.aggregate({ where: { guildId, date: dateKey }, _sum: { messageCount: true } }),
      db.userActivityDaily.count({ where: { guildId, date: dateKey, messageCount: { gt: 0 } } }),
      db.channelActivityDaily.count({ where: { guildId, date: dateKey, messageCount: { gt: 0 } } }),
      db.memberEvent.count({ where: { guildId, type: 'JOIN', at } }),
      db.memberEvent.count({ where: { guildId, type: 'LEAVE', at } }),
      db.moderationAction.count({ where: { guildId, createdAt: at, status: { not: 'FAILED' } } }),
      db.automodEvent.count({ where: { guildId, createdAt: at } }),
      db.abuseReport.count({ where: { guildId, createdAt: at } }),
      db.incident.count({ where: { guildId, startedAt: at } }),
      db.announcement.count({ where: { guildId, status: 'PUBLISHED', publishedAt: at } }),
      db.analyticsDaily.findUnique({ where: { guildId_date: { guildId, date: dateKey } }, select: { metrics: true } }),
      isToday ? db.guild.findUnique({ where: { id: guildId }, select: { memberCount: true, memberCountAt: true } }) : Promise.resolve(null),
      isToday ? db.trackedLink.findFirst({ where: { guildId }, select: { id: true } }) : Promise.resolve(null),
    ]);

  const prev = (existing?.metrics ?? {}) as Partial<DailyMetrics>;
  const metrics: DailyMetrics = {
    version: 1,
    messages: messages._sum.messageCount ?? 0,
    activeUsers,
    activeChannels,
    joins,
    leaves,
    moderationActions,
    automodDetections,
    abuseReportsReceived,
    incidentsOpened,
    announcementsPublished,
  };
  if (isToday) {
    if (guild?.memberCountAt) {
      metrics.memberCount = guild.memberCount;
      metrics.memberCountAt = guild.memberCountAt.toISOString();
    }
    if (hasLinks) {
      metrics.trackedLinkClicksTotal = await liveTrackedLinkClicks(db, guildId);
      metrics.trackedLinkClicksAt = now.toISOString();
    }
  } else {
    for (const k of ['memberCount', 'memberCountAt', 'trackedLinkClicksTotal', 'trackedLinkClicksAt'] as const) {
      if (prev[k] !== undefined) (metrics as unknown as Record<string, unknown>)[k] = prev[k];
    }
  }
  const json = metrics as unknown as Prisma.InputJsonValue;
  await db.analyticsDaily.upsert({
    where: { guildId_date: { guildId, date: dateKey } },
    create: { guildId, date: dateKey, metrics: json, computedAt: now },
    update: { metrics: json, computedAt: now },
  });
  return metrics;
}

/** Recompute yesterday and today (guild timezone). Safe to run any number of times. */
export async function runDailyRollup(db: Db, guildId: string, tz: string, now: Date): Promise<string[]> {
  const today = dateKeyInZone(now, tz);
  const yesterday = addDaysToKey(today, -1);
  await computeDailyRollup(db, guildId, yesterday, tz, now);
  await computeDailyRollup(db, guildId, today, tz, now);
  return [yesterday, today];
}
