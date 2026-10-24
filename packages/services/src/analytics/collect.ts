import type { Db, Prisma } from '@gynx/database';
import { dateKeyInZone, formatInZone } from '@gynx/shared';
import {
  addDaysToKey,
  available,
  averageDaily,
  countActiveMembers,
  dateKeysBetween,
  fromSource,
  incidentDurationMs,
  memberFlow,
  periodClicks,
  topN,
  unavailable,
  uptimePercent,
  withPrevious,
  type Metric,
  type Period,
} from './metrics';

/**
 * Data collection for analytics. Reads other modules' tables directly (read-only)
 * so analytics works regardless of which feature modules are deployed.
 *
 * Time semantics:
 *  - Event metrics (joins, actions, incidents …) use exact instants: `start ≤ t < end`.
 *  - Message-activity metrics are day-granular in the guild timezone: the days from
 *    the start's calendar date (inclusive) to the end's calendar date (exclusive).
 *    Consecutive report periods therefore never double-count a day.
 *  - Point-in-time metrics (backlogs, member count) are evaluated "as of" min(end, now).
 */

export interface CollectOptions {
  tz: string;
  now: Date;
  activeMemberMinMessages: number;
}

export interface CommunitySection {
  totalMembers: Metric<number>;
  joins: Metric<number>;
  leaves: Metric<number>;
  netGrowth: Metric<number>;
  activeMembers: Metric<number>;
  messages: Metric<number>;
  topChannels: Metric<Array<{ channelId: string; messages: number }>>;
  dau: Metric<number>;
  wau: Metric<number>;
  mau: Metric<number>;
  activeMemberThreshold: number;
  activityDays: number;
}

export interface ReferralSection {
  attributedJoins: Metric<number>;
  confirmed: Metric<number>;
  ambiguous: Metric<number>;
  unknown: Metric<number>;
  flagged: Metric<number>;
  topReferrers: Metric<Array<{ userId: string; validConfirmed: number }>>;
}

export interface ModerationSection {
  actions: Metric<number>;
  actionsByType: Metric<Record<string, number>>;
  automodDetections: Metric<number>;
  automodByRule: Metric<Record<string, number>>;
  automodFalsePositives: Metric<number>;
  reportsReceived: Metric<number>;
  reportsResolved: Metric<number>;
  reportsDismissed: Metric<number>;
  reportsByCategory: Metric<Record<string, number>>;
  openReportBacklog: Metric<number>;
}

export interface ServiceUptime {
  serviceId: string;
  name: string;
  checks: number;
  /** null = no data in the period. */
  uptimePct: number | null;
}

export interface InfrastructureSection {
  incidentsOpened: Metric<number>;
  incidentsResolved: Metric<number>;
  incidentsBySeverity: Metric<Record<string, number>>;
  incidentMinutes: Metric<number>;
  autoIncidents: Metric<number>;
  manualIncidents: Metric<number>;
  uptime: ServiceUptime[];
}

export interface MarketingSection {
  announcementsPublished: Metric<number>;
  announcementReactions: Metric<number>;
  trackedLinkClicks: Metric<number>;
  partnerApplications: Metric<number>;
  partnerApplicationsByStatus: Metric<Record<string, number>>;
  eventRsvps: Metric<number>;
  giveawayEntries: Metric<number>;
  pollBallots: Metric<number>;
  suggestionsCreated: Metric<number>;
}

export interface OutstandingSection {
  asOf: string;
  staleAbuseReports: number;
  activeIncidents: Array<{ ref: string; title: string; severity: string; startedAt: string }>;
  deadJobs: number;
  flaggedReferrals: number;
  stalePartnerApplications: number;
}

/** Which data sources have ever recorded a row for the guild. Computed once per report. */
export interface SourcePresence {
  memberEvents: boolean;
  activity: boolean;
  referrals: boolean;
  moderation: boolean;
  automod: boolean;
  abuseReports: boolean;
  monitoring: boolean;
  announcements: boolean;
  trackedLinks: boolean;
  partnerApps: boolean;
  events: boolean;
  giveaways: boolean;
  polls: boolean;
  suggestions: boolean;
}

const exists = async (p: Promise<unknown>) => (await p) !== null;

export async function sourcePresence(db: Db, guildId: string): Promise<SourcePresence> {
  const w = { where: { guildId }, select: { guildId: true } } as const;
  const [
    memberEvents,
    activity,
    referrals,
    moderation,
    automod,
    abuseReports,
    incidents,
    services,
    announcements,
    trackedLinks,
    partnerApps,
    events,
    giveaways,
    polls,
    suggestions,
  ] = await Promise.all([
    exists(db.memberEvent.findFirst(w)),
    exists(db.userActivityDaily.findFirst(w)),
    exists(db.referralAttribution.findFirst(w)),
    exists(db.moderationAction.findFirst(w)),
    exists(db.automodEvent.findFirst(w)),
    exists(db.abuseReport.findFirst(w)),
    exists(db.incident.findFirst(w)),
    exists(db.monitoredService.findFirst(w)),
    exists(db.announcement.findFirst(w)),
    exists(db.trackedLink.findFirst(w)),
    exists(db.partnerApplication.findFirst(w)),
    exists(db.communityEvent.findFirst(w)),
    exists(db.giveaway.findFirst(w)),
    exists(db.poll.findFirst(w)),
    exists(db.suggestion.findFirst(w)),
  ]);
  return {
    memberEvents,
    activity,
    referrals,
    moderation,
    automod,
    abuseReports,
    monitoring: incidents || services,
    announcements,
    trackedLinks,
    partnerApps,
    events,
    giveaways,
    polls,
    suggestions,
  };
}

const REASONS = {
  memberEvents: 'no join/leave events have been recorded yet',
  activity: 'no message activity has been recorded yet',
  referrals: 'no referral attributions have been recorded yet',
  moderation: 'no moderation actions have been recorded yet',
  automod: 'no automod detections have been recorded yet',
  abuseReports: 'no abuse reports have been recorded yet',
  monitoring: 'status monitoring has no services or incidents configured',
  announcements: 'no announcements have been created yet',
  trackedLinks: 'no tracked links exist',
  partnerApps: 'no partner applications have been received yet',
  events: 'no community events have been created yet',
  giveaways: 'no giveaways have been created yet',
  polls: 'no polls have been created yet',
  suggestions: 'no suggestions have been submitted yet',
} as const;

const inPeriod = (p: Period) => ({ gte: p.start, lt: p.end });
const asOfFor = (p: Period, now: Date) => new Date(Math.min(p.end.getTime(), now.getTime()));

export function activityKeys(p: Period, tz: string): { keys: string[]; startKey: string; endKey: string } {
  const startKey = dateKeyInZone(p.start, tz);
  const endKey = dateKeyInZone(p.end, tz);
  return { keys: dateKeysBetween(startKey, endKey), startKey, endKey };
}

function countsBy<T extends string>(
  rows: ReadonlyArray<Record<string, unknown> & { _count: { _all: number } }>,
  key: string,
): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const r of rows) out[r[key] as T] = r._count._all;
  return out;
}

// ── Community ──────────────────────────────────────────────────────────────

interface DailySnapshot {
  memberCount?: number;
  memberCountAt?: string;
  trackedLinkClicksTotal?: number;
}

async function dailySnapshot(db: Db, guildId: string, date: string): Promise<DailySnapshot | null> {
  const row = await db.analyticsDaily.findUnique({
    where: { guildId_date: { guildId, date } },
    select: { metrics: true },
  });
  return row ? (row.metrics as DailySnapshot) : null;
}

async function memberCountMetric(
  db: Db,
  guildId: string,
  p: Period,
  opts: CollectOptions,
  lastKey: string | undefined,
): Promise<Metric<number>> {
  const guild = await db.guild.findUnique({
    where: { id: guildId },
    select: { memberCount: true, memberCountAt: true },
  });
  const asOf = asOfFor(p, opts.now);
  // Live snapshot when it's fresh relative to the period end.
  if (
    guild?.memberCountAt &&
    guild.memberCountAt <= asOf &&
    asOf.getTime() - guild.memberCountAt.getTime() <= 36 * 3_600_000
  ) {
    return available(guild.memberCount, `snapshot at ${formatInZone(guild.memberCountAt, opts.tz)}`);
  }
  if (lastKey) {
    const rows = await db.analyticsDaily.findMany({
      where: { guildId, date: { lte: lastKey } },
      orderBy: { date: 'desc' },
      take: 7,
      select: { metrics: true },
    });
    for (const r of rows) {
      const m = r.metrics as DailySnapshot;
      if (typeof m.memberCount === 'number' && m.memberCountAt) {
        return available(m.memberCount, `snapshot at ${formatInZone(new Date(m.memberCountAt), opts.tz)}`);
      }
    }
  }
  return unavailable('no member-count snapshot was recorded for this period');
}

export async function collectCommunity(
  db: Db,
  guildId: string,
  p: Period,
  opts: CollectOptions,
  src: SourcePresence,
): Promise<CommunitySection> {
  const { keys, startKey, endKey } = activityKeys(p, opts.tz);
  const lastKey = keys[keys.length - 1];
  const threshold = Math.max(1, opts.activeMemberMinMessages);
  const activityWhere = { guildId, date: { gte: startKey, lt: endKey } };
  const wauStart = lastKey ? addDaysToKey(lastKey, -6) : endKey;
  const mauStart = lastKey ? addDaysToKey(lastKey, -29) : endKey;

  const [totalMembers, flowRows, perUser, perChannel, perDay, wauRows, mauRows] = await Promise.all([
    memberCountMetric(db, guildId, p, opts, lastKey),
    db.memberEvent.groupBy({ by: ['type'], where: { guildId, at: inPeriod(p) }, _count: { _all: true } }),
    db.userActivityDaily.groupBy({ by: ['userId'], where: activityWhere, _sum: { messageCount: true } }),
    db.channelActivityDaily.groupBy({
      by: ['channelId'],
      where: activityWhere,
      _sum: { messageCount: true },
    }),
    db.userActivityDaily.groupBy({
      by: ['date'],
      where: { ...activityWhere, messageCount: { gt: 0 } },
      _count: { _all: true },
    }),
    db.userActivityDaily.groupBy({
      by: ['userId'],
      where: { guildId, date: { gte: wauStart, lt: endKey }, messageCount: { gt: 0 } },
    }),
    db.userActivityDaily.groupBy({
      by: ['userId'],
      where: { guildId, date: { gte: mauStart, lt: endKey }, messageCount: { gt: 0 } },
    }),
  ]);

  const flow = memberFlow(flowRows.map((r) => ({ type: r.type, count: r._count._all })));
  const channelCounts = new Map(perChannel.map((r) => [r.channelId, r._sum.messageCount ?? 0]));
  const messages = [...channelCounts.values()].reduce((a, b) => a + b, 0);
  const note = 'observed message activity';
  const act = <T>(v: T, n = note) => fromSource(src.activity, v, REASONS.activity, n);

  return {
    totalMembers,
    joins: fromSource(src.memberEvents, flow.joins, REASONS.memberEvents),
    leaves: fromSource(src.memberEvents, flow.leaves, REASONS.memberEvents),
    netGrowth: fromSource(src.memberEvents, flow.net, REASONS.memberEvents),
    activeMembers: act(
      countActiveMembers(
        perUser.map((r) => ({ userId: r.userId, messages: r._sum.messageCount ?? 0 })),
        threshold,
      ),
      `${note}; at least ${threshold} message${threshold === 1 ? '' : 's'}`,
    ),
    messages: act(messages),
    topChannels: act(topN(channelCounts, 5).map((e) => ({ channelId: e.id, messages: e.count }))),
    dau: act(
      averageDaily(new Map(perDay.map((r) => [r.date, r._count._all])), keys),
      `${note}; daily average`,
    ),
    wau: act(wauRows.length, `${note}; last 7 days of period`),
    mau: act(mauRows.length, `${note}; last 30 days of period`),
    activeMemberThreshold: threshold,
    activityDays: keys.length,
  };
}

// ── Referrals ──────────────────────────────────────────────────────────────

export async function collectReferrals(
  db: Db,
  guildId: string,
  p: Period,
  _opts: CollectOptions,
  src: SourcePresence,
): Promise<ReferralSection> {
  const where = { guildId, joinedAt: inPeriod(p) };
  const [byConfidence, flagged, top] = await Promise.all([
    db.referralAttribution.groupBy({ by: ['confidence'], where, _count: { _all: true } }),
    db.referralAttribution.count({ where: { ...where, status: 'FLAGGED' } }),
    db.referralAttribution.groupBy({
      by: ['referrerId'],
      where: { ...where, confidence: 'CONFIRMED', status: 'VALID', referrerId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const c = countsBy<string>(byConfidence, 'confidence');
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const m = <T>(v: T, note?: string) => fromSource(src.referrals, v, REASONS.referrals, note);
  const topMap = new Map(top.filter((r) => r.referrerId).map((r) => [r.referrerId!, r._count._all]));
  return {
    attributedJoins: m(total),
    confirmed: m(c.CONFIRMED ?? 0),
    ambiguous: m(c.AMBIGUOUS ?? 0),
    unknown: m(c.UNKNOWN ?? 0, 'joins with no attributable invite'),
    flagged: m(flagged),
    topReferrers: m(topN(topMap, 5).map((e) => ({ userId: e.id, validConfirmed: e.count }))),
  };
}

// ── Moderation & security ──────────────────────────────────────────────────

export async function collectModeration(
  db: Db,
  guildId: string,
  p: Period,
  opts: CollectOptions,
  src: SourcePresence,
): Promise<ModerationSection> {
  const asOf = asOfFor(p, opts.now);
  const [actions, rules, falsePositives, received, resolved, dismissed, categories, backlog] =
    await Promise.all([
      db.moderationAction.groupBy({
        by: ['type'],
        where: { guildId, createdAt: inPeriod(p), status: { not: 'FAILED' } },
        _count: { _all: true },
      }),
      db.automodEvent.groupBy({
        by: ['rule'],
        where: { guildId, createdAt: inPeriod(p) },
        _count: { _all: true },
      }),
      db.automodEvent.count({ where: { guildId, createdAt: inPeriod(p), falsePositive: true } }),
      db.abuseReport.count({ where: { guildId, createdAt: inPeriod(p) } }),
      db.abuseReport.count({ where: { guildId, status: 'RESOLVED', resolvedAt: inPeriod(p) } }),
      db.abuseReport.count({ where: { guildId, status: 'DISMISSED', resolvedAt: inPeriod(p) } }),
      db.abuseReport.groupBy({
        by: ['category'],
        where: { guildId, createdAt: inPeriod(p) },
        _count: { _all: true },
      }),
      // Open as of `asOf`: created before it and not closed before it.
      db.abuseReport.count({
        where: {
          guildId,
          createdAt: { lt: asOf },
          OR: [{ resolvedAt: null }, { resolvedAt: { gte: asOf } }],
        },
      }),
    ]);
  const byType = countsBy<string>(actions, 'type');
  const byRule = countsBy<string>(rules, 'rule');
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  const mod = <T>(v: T) => fromSource(src.moderation, v, REASONS.moderation);
  const am = <T>(v: T, n?: string) => fromSource(src.automod, v, REASONS.automod, n);
  const ar = <T>(v: T, n?: string) => fromSource(src.abuseReports, v, REASONS.abuseReports, n);
  return {
    actions: mod(sum(byType)),
    actionsByType: mod(byType),
    automodDetections: am(sum(byRule)),
    automodByRule: am(byRule),
    automodFalsePositives: am(falsePositives, 'reviewed as false positive'),
    reportsReceived: ar(received),
    reportsResolved: ar(resolved),
    reportsDismissed: ar(dismissed),
    reportsByCategory: ar(countsBy<string>(categories, 'category')),
    openReportBacklog: ar(backlog, 'open at period end'),
  };
}

// ── Infrastructure ─────────────────────────────────────────────────────────

export async function collectInfrastructure(
  db: Db,
  guildId: string,
  p: Period,
  opts: CollectOptions,
  src: SourcePresence,
): Promise<InfrastructureSection> {
  const asOf = asOfFor(p, opts.now);
  const [opened, resolved, overlapping, services, checks, checksOk] = await Promise.all([
    db.incident.findMany({
      where: { guildId, startedAt: inPeriod(p) },
      select: { severity: true, autoCreated: true },
    }),
    db.incident.count({ where: { guildId, resolvedAt: inPeriod(p) } }),
    db.incident.findMany({
      where: {
        guildId,
        startedAt: { lt: p.end },
        OR: [{ resolvedAt: null }, { resolvedAt: { gt: p.start } }],
      },
      select: { startedAt: true, resolvedAt: true },
    }),
    db.monitoredService.findMany({
      where: { guildId, public: true, enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    db.healthCheck.groupBy({
      by: ['serviceId'],
      where: { service: { guildId }, checkedAt: inPeriod(p) },
      _count: { _all: true },
    }),
    db.healthCheck.groupBy({
      by: ['serviceId'],
      where: { service: { guildId }, checkedAt: inPeriod(p), ok: true },
      _count: { _all: true },
    }),
  ]);
  const severity: Record<string, number> = {};
  let auto = 0;
  for (const i of opened) {
    severity[i.severity] = (severity[i.severity] ?? 0) + 1;
    if (i.autoCreated) auto++;
  }
  const total = new Map(checks.map((c) => [c.serviceId, c._count._all]));
  const ok = new Map(checksOk.map((c) => [c.serviceId, c._count._all]));
  const m = <T>(v: T, n?: string) => fromSource(src.monitoring, v, REASONS.monitoring, n);
  return {
    incidentsOpened: m(opened.length),
    incidentsResolved: m(resolved),
    incidentsBySeverity: m(severity),
    incidentMinutes: m(
      Math.round(incidentDurationMs(overlapping, p, asOf) / 60_000),
      'total incident time within period',
    ),
    autoIncidents: m(auto),
    manualIncidents: m(opened.length - auto),
    uptime: services.map((s) => ({
      serviceId: s.id,
      name: s.name,
      checks: total.get(s.id) ?? 0,
      uptimePct: uptimePercent(ok.get(s.id) ?? 0, total.get(s.id) ?? 0),
    })),
  };
}

// ── Marketing & engagement ─────────────────────────────────────────────────

export async function liveTrackedLinkClicks(db: Db, guildId: string): Promise<number> {
  const r = await db.trackedLink.aggregate({ where: { guildId }, _sum: { clicks: true } });
  return r._sum.clicks ?? 0;
}

export async function collectMarketing(
  db: Db,
  guildId: string,
  p: Period,
  opts: CollectOptions,
  src: SourcePresence,
): Promise<MarketingSection> {
  const { startKey, endKey, keys } = activityKeys(p, opts.tz);
  const lastKey = keys[keys.length - 1];
  const publishedWhere: Prisma.AnnouncementWhereInput = {
    guildId,
    status: 'PUBLISHED',
    publishedAt: inPeriod(p),
  };
  const [
    published,
    deliveries,
    partnerByStatus,
    rsvps,
    entries,
    ballots,
    suggestions,
    baselineSnap,
    endSnap,
  ] = await Promise.all([
    db.announcement.count({ where: publishedWhere }),
    db.announcementDelivery.aggregate({
      where: { success: true, announcement: publishedWhere },
      _sum: { reactionCount: true },
      _count: { _all: true },
    }),
    db.partnerApplication.groupBy({
      by: ['status'],
      where: { guildId, createdAt: inPeriod(p) },
      _count: { _all: true },
    }),
    db.eventRsvp.count({ where: { status: 'GOING', createdAt: inPeriod(p), event: { guildId } } }),
    db.giveawayEntry.count({ where: { createdAt: inPeriod(p), giveaway: { guildId } } }),
    db.pollBallot.count({ where: { createdAt: inPeriod(p), poll: { guildId } } }),
    db.suggestion.count({ where: { guildId, createdAt: inPeriod(p) } }),
    dailySnapshot(db, guildId, addDaysToKey(startKey, -1)),
    lastKey ? dailySnapshot(db, guildId, lastKey) : Promise.resolve(null),
  ]);

  let clicks: Metric<number>;
  if (!src.trackedLinks) clicks = unavailable(REASONS.trackedLinks);
  else {
    let end: number | null = endSnap?.trackedLinkClicksTotal ?? null;
    // Period ending now (dashboard views / the report being generated): use the live counter.
    if (opts.now.getTime() - p.end.getTime() < 36 * 3_600_000 && dateKeyInZone(opts.now, opts.tz) >= endKey) {
      end = await liveTrackedLinkClicks(db, guildId);
    }
    clicks = periodClicks(baselineSnap?.trackedLinkClicksTotal ?? null, end);
  }

  const partner = countsBy<string>(partnerByStatus, 'status');
  const pa = <T>(v: T) => fromSource(src.partnerApps, v, REASONS.partnerApps);
  return {
    announcementsPublished: fromSource(src.announcements, published, REASONS.announcements),
    announcementReactions:
      deliveries._count._all > 0
        ? available(deliveries._sum.reactionCount ?? 0, 'as last synced')
        : unavailable('not available — no delivered announcements with reaction data in this period'),
    trackedLinkClicks: clicks,
    partnerApplications: pa(Object.values(partner).reduce((a, b) => a + b, 0)),
    partnerApplicationsByStatus: pa(partner),
    eventRsvps: fromSource(src.events, rsvps, REASONS.events, 'RSVPs marked going'),
    giveawayEntries: fromSource(src.giveaways, entries, REASONS.giveaways),
    pollBallots: fromSource(src.polls, ballots, REASONS.polls),
    suggestionsCreated: fromSource(src.suggestions, suggestions, REASONS.suggestions),
  };
}

// ── Outstanding issues (point in time) ─────────────────────────────────────

export async function collectOutstanding(db: Db, guildId: string, asOf: Date): Promise<OutstandingSection> {
  const [staleReports, active, dead, flagged, stalePartners] = await Promise.all([
    db.abuseReport.count({
      where: {
        guildId,
        status: { in: ['NEW', 'TRIAGED', 'INVESTIGATING'] },
        createdAt: { lt: new Date(asOf.getTime() - 72 * 3_600_000) },
      },
    }),
    db.incident.findMany({
      where: { guildId, status: { not: 'RESOLVED' } },
      orderBy: { startedAt: 'asc' },
      take: 10,
      select: { ref: true, title: true, severity: true, startedAt: true },
    }),
    db.scheduledJob.count({ where: { status: 'DEAD', OR: [{ guildId }, { guildId: null }] } }),
    db.referralAttribution.count({ where: { guildId, status: 'FLAGGED' } }),
    db.partnerApplication.count({
      where: { guildId, status: 'PENDING', createdAt: { lt: new Date(asOf.getTime() - 7 * 86_400_000) } },
    }),
  ]);
  return {
    asOf: asOf.toISOString(),
    staleAbuseReports: staleReports,
    activeIncidents: active.map((i) => ({
      ref: i.ref,
      title: i.title,
      severity: i.severity,
      startedAt: i.startedAt.toISOString(),
    })),
    deadJobs: dead,
    flaggedReferrals: flagged,
    stalePartnerApplications: stalePartners,
  };
}

// ── Merging current + previous ─────────────────────────────────────────────

const isMetric = (v: unknown): v is Metric<unknown> =>
  typeof v === 'object' && v !== null && 'available' in v;

/**
 * Attach previous-period values to every Metric field of a section (scalars and
 * breakdown records). Non-metric fields are kept from the current section.
 */
export function mergeSection<S extends object>(current: S, previous: S): S {
  const out = { ...current } as Record<string, unknown>;
  for (const [k, v] of Object.entries(current)) {
    const pv = (previous as Record<string, unknown>)[k];
    if (isMetric(v) && isMetric(pv)) {
      const val = v.available ? v.value : undefined;
      // Lists (top channels/referrers) have no meaningful numeric comparison.
      if (Array.isArray(val)) continue;
      out[k] = withPrevious(v, pv);
    }
  }
  return out as S;
}
