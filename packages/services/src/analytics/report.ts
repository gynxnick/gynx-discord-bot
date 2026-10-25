import type { Db } from '@gynx/database';
import { formatDuration, formatInZone } from '@gynx/shared';
import {
  collectCommunity,
  collectInfrastructure,
  collectMarketing,
  collectModeration,
  collectOutstanding,
  collectReferrals,
  mergeSection,
  sourcePresence,
  type CollectOptions,
  type CommunitySection,
  type InfrastructureSection,
  type MarketingSection,
  type ModerationSection,
  type OutstandingSection,
  type ReferralSection,
} from './collect';
import {
  compare,
  fmtNum,
  formatComparison,
  formatMetric,
  previousPeriod,
  type Metric,
  type Period,
} from './metrics';

import { AnalyticsText as T } from './texts';

export { ACTIVITY_NOTE, SUPPORT_NOTE } from './texts';

export interface ReportData {
  version: 1;
  guildId: string;
  timezone: string;
  period: { start: string; end: string };
  previousPeriod: { start: string; end: string };
  generatedAt: string;
  community: CommunitySection;
  referrals: ReferralSection;
  moderation: ModerationSection;
  infrastructure: InfrastructureSection;
  marketing: MarketingSection;
  outstanding: OutstandingSection;
  summary: string[];
  flat: FlatMetric[];
}

/** One row of the flat metric table (comparison table, CSV export, executive summary). */
export interface FlatMetric {
  section: string;
  key: string;
  label: string;
  available: boolean;
  value: number | null;
  previous: number | null;
  delta: number | null;
  pct: number | null;
  /** Unavailability reason or a qualifying note. */
  note: string | null;
  /** Breakdown rows (e.g. actions by type) are excluded from the comparison table. */
  breakdown: boolean;
}

type SectionKey = 'community' | 'referrals' | 'moderation' | 'infrastructure' | 'marketing';
interface MetricDef {
  section: SectionKey;
  field: string;
  label: string;
}

/** The scalar and breakdown metrics in report order. */
export const METRIC_DEFS: readonly MetricDef[] = [
  { section: 'community', field: 'totalMembers', label: 'Total members' },
  { section: 'community', field: 'joins', label: 'Joins' },
  { section: 'community', field: 'leaves', label: 'Leaves' },
  { section: 'community', field: 'netGrowth', label: 'Net member growth' },
  { section: 'community', field: 'activeMembers', label: 'Active members' },
  { section: 'community', field: 'messages', label: 'Messages' },
  { section: 'community', field: 'dau', label: 'Daily active (avg)' },
  { section: 'community', field: 'wau', label: 'Weekly active' },
  { section: 'community', field: 'mau', label: 'Monthly active' },
  { section: 'referrals', field: 'attributedJoins', label: 'Referral-tracked joins' },
  { section: 'referrals', field: 'confirmed', label: 'Referrals: confirmed' },
  { section: 'referrals', field: 'ambiguous', label: 'Referrals: ambiguous' },
  { section: 'referrals', field: 'unknown', label: 'Referrals: unknown source' },
  { section: 'referrals', field: 'flagged', label: 'Referrals: flagged' },
  { section: 'moderation', field: 'actions', label: 'Moderation actions' },
  { section: 'moderation', field: 'actionsByType', label: 'Moderation actions' },
  { section: 'moderation', field: 'automodDetections', label: 'Automod detections' },
  { section: 'moderation', field: 'automodByRule', label: 'Automod detections' },
  { section: 'moderation', field: 'automodFalsePositives', label: 'Automod false positives' },
  { section: 'moderation', field: 'reportsReceived', label: 'Abuse reports received' },
  { section: 'moderation', field: 'reportsResolved', label: 'Abuse reports resolved' },
  { section: 'moderation', field: 'reportsDismissed', label: 'Abuse reports dismissed' },
  { section: 'moderation', field: 'reportsByCategory', label: 'Abuse reports' },
  { section: 'moderation', field: 'openReportBacklog', label: 'Open abuse report backlog' },
  { section: 'infrastructure', field: 'incidentsOpened', label: 'Incidents opened' },
  { section: 'infrastructure', field: 'incidentsResolved', label: 'Incidents resolved' },
  { section: 'infrastructure', field: 'incidentsBySeverity', label: 'Incidents' },
  { section: 'infrastructure', field: 'incidentMinutes', label: 'Incident time (minutes)' },
  { section: 'infrastructure', field: 'autoIncidents', label: 'Auto-detected incidents' },
  { section: 'infrastructure', field: 'manualIncidents', label: 'Manually declared incidents' },
  { section: 'marketing', field: 'announcementsPublished', label: 'Announcements published' },
  { section: 'marketing', field: 'announcementReactions', label: 'Announcement reactions' },
  { section: 'marketing', field: 'trackedLinkClicks', label: 'Tracked link clicks' },
  { section: 'marketing', field: 'partnerApplications', label: 'Partner applications' },
  { section: 'marketing', field: 'partnerApplicationsByStatus', label: 'Partner applications' },
  { section: 'marketing', field: 'eventRsvps', label: 'Event RSVPs (going)' },
  { section: 'marketing', field: 'giveawayEntries', label: 'Giveaway entries' },
  { section: 'marketing', field: 'pollBallots', label: 'Poll ballots' },
  { section: 'marketing', field: 'suggestionsCreated', label: 'Suggestions created' },
];

type Sections = Pick<ReportData, SectionKey>;

/** Flatten sections into metric rows. Breakdown records become one row per entry. */
export function flattenMetrics(data: Sections): FlatMetric[] {
  const rows: FlatMetric[] = [];
  for (const def of METRIC_DEFS) {
    const m = (data[def.section] as unknown as Record<string, Metric<unknown>>)[def.field];
    if (!m) continue;
    const base = { section: def.section, key: `${def.section}.${def.field}` };
    if (!m.available) {
      rows.push({
        ...base,
        label: def.label,
        available: false,
        value: null,
        previous: null,
        delta: null,
        pct: null,
        note: m.reason,
        breakdown: false,
      });
      continue;
    }
    if (typeof m.value === 'number') {
      const prev = typeof m.previous === 'number' ? m.previous : null;
      const c = compare(m.value, prev);
      rows.push({
        ...base,
        label: def.label,
        available: true,
        value: m.value,
        previous: prev,
        ...c,
        note: m.note ?? null,
        breakdown: false,
      });
      continue;
    }
    if (m.value && typeof m.value === 'object' && !Array.isArray(m.value)) {
      const cur = m.value as Record<string, number>;
      const prev = (m.previous ?? null) as Record<string, number> | null;
      const keys = [...new Set([...Object.keys(cur), ...Object.keys(prev ?? {})])].sort();
      for (const k of keys) {
        const v = cur[k] ?? 0;
        const p = prev ? (prev[k] ?? 0) : null;
        rows.push({
          ...base,
          key: `${base.key}.${k}`,
          label: `${def.label}: ${humanise(k)}`,
          available: true,
          value: v,
          previous: p,
          ...compare(v, p),
          note: null,
          breakdown: true,
        });
      }
    }
  }
  return rows;
}

export const humanise = (enumValue: string) =>
  enumValue.charAt(0) + enumValue.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * 3–6 bullet highlights computed from the data: growth, the biggest relative changes,
 * incidents, the security backlog and anything awaiting attention.
 */
export function executiveSummary(
  d: Omit<ReportData, 'summary' | 'flat'>,
  flat: readonly FlatMetric[],
): string[] {
  const out: string[] = [];
  const c = d.community;
  if (c.netGrowth.available && c.joins.available && c.leaves.available) {
    const total = c.totalMembers.available
      ? T.summaryGrowthTotal({ members: fmtNum(c.totalMembers.value) })
      : '';
    out.push(
      T.summaryGrowth({
        net: `${c.netGrowth.value > 0 ? '+' : ''}${fmtNum(c.netGrowth.value)}`,
        joins: fmtNum(c.joins.value),
        leaves: fmtNum(c.leaves.value),
        total,
      }),
    );
  } else if (c.totalMembers.available) {
    out.push(
      T.summaryMembersOnly({
        members: fmtNum(c.totalMembers.value),
        note: c.totalMembers.note ?? T.summaryLatestSnapshot(),
      }),
    );
  }
  if (c.activeMembers.available && c.messages.available) {
    out.push(
      T.summaryActivity({ active: fmtNum(c.activeMembers.value), messages: fmtNum(c.messages.value) }),
    );
  }

  const rest: string[] = [];
  const inf = d.infrastructure;
  if (inf.incidentsOpened.available) {
    if (inf.incidentsOpened.value === 0) rest.push(T.summaryNoIncidents());
    else {
      const sev = inf.incidentsBySeverity.available ? inf.incidentsBySeverity.value : {};
      const serious = (sev.CRITICAL ?? 0) + (sev.MAJOR ?? 0);
      const mins = inf.incidentMinutes.available
        ? T.summaryIncidentTime({ time: formatDuration(inf.incidentMinutes.value * 60_000) })
        : '';
      const n = inf.incidentsOpened.value;
      rest.push(
        T.summaryIncidents({
          incidents: n === 1 ? T.countIncidentOne({ count: n }) : T.countIncidentMany({ count: n }),
          serious,
          time: mins,
        }),
      );
    }
  }

  const mod = d.moderation;
  if (mod.openReportBacklog.available) {
    const n = mod.openReportBacklog.value;
    const count = fmtNum(n);
    rest.push(
      T.summarySecurity({
        reports: n === 1 ? T.countOpenReportOne({ count }) : T.countOpenReportMany({ count }),
        stale: d.outstanding.staleAbuseReports,
        received: mod.reportsReceived.available
          ? T.summarySecurityReceived({ count: fmtNum(mod.reportsReceived.value) })
          : '.',
      }),
    );
  }

  const o = d.outstanding;
  const counted = (count: number, one: typeof T.none, many: typeof T.none) =>
    count ? (count === 1 ? one({ count }) : many({ count })) : null;
  const attention = [
    counted(o.activeIncidents.length, T.countActiveIncidentOne, T.countActiveIncidentMany),
    counted(o.deadJobs, T.countFailedJobOne, T.countFailedJobMany),
    counted(o.flaggedReferrals, T.countFlaggedReferralOne, T.countFlaggedReferralMany),
    counted(o.stalePartnerApplications, T.countPendingPartnerAppOne, T.countPendingPartnerAppMany),
  ].filter(Boolean);
  if (attention.length) rest.push(T.summaryAttention({ items: attention.join(', ') }));

  // Biggest relative changes fill the remaining room (max 2), placed after the community bullets.
  const room = Math.max(0, Math.min(2, 6 - out.length - rest.length));
  const changes = flat
    .filter(
      (r) =>
        !r.breakdown &&
        r.available &&
        r.previous !== null &&
        r.previous > 0 &&
        r.pct !== null &&
        Math.abs(r.delta ?? 0) >= 3,
    )
    .sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!))
    .slice(0, room)
    .map((r) =>
      T.summaryNotableChange({
        metric: r.label,
        direction: r.delta! > 0 ? T.changeUp() : T.changeDown(),
        pct: Math.abs(r.pct!),
        value: fmtNum(r.value!),
        previous: fmtNum(r.previous!),
      }),
    );
  out.push(...changes, ...rest);

  const scalar = flat.filter((r) => !r.breakdown);
  const missing = scalar.filter((r) => !r.available).length;
  if (out.length < 3 && missing > 0) out.push(T.summaryCoverage({ missing, total: scalar.length }));
  if (out.length < 3 && attention.length === 0) out.push(T.summaryNoIssues());
  if (out.length < 3) out.push(T.supportNote() + '.');
  return out.slice(0, 6);
}

export interface BuildReportInput {
  guildId: string;
  period: Period;
  opts: CollectOptions;
}

/** Compute every section for the period and the previous equal-length period. */
export async function buildReportData(
  db: Db,
  { guildId, period, opts }: BuildReportInput,
): Promise<ReportData> {
  const prev = previousPeriod(period);
  const src = await sourcePresence(db, guildId);
  const both = <S extends object>(
    fn: (db: Db, g: string, p: Period, o: CollectOptions, s: typeof src) => Promise<S>,
  ) =>
    Promise.all([fn(db, guildId, period, opts, src), fn(db, guildId, prev, opts, src)]).then(([c, p]) =>
      mergeSection(c, p),
    );

  const [community, referrals, moderation, infrastructure, marketing, outstanding] = await Promise.all([
    both(collectCommunity),
    both(collectReferrals),
    both(collectModeration),
    both(collectInfrastructure),
    both(collectMarketing),
    collectOutstanding(db, guildId, new Date(Math.min(period.end.getTime(), opts.now.getTime()))),
  ]);
  const base = {
    version: 1 as const,
    guildId,
    timezone: opts.tz,
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    previousPeriod: { start: prev.start.toISOString(), end: prev.end.toISOString() },
    generatedAt: opts.now.toISOString(),
    community,
    referrals,
    moderation,
    infrastructure,
    marketing,
    outstanding,
  };
  const flat = flattenMetrics(base);
  return { ...base, flat, summary: executiveSummary(base, flat) };
}

// ── Rendering ──────────────────────────────────────────────────────────────

const bullet = (label: string, value: string) => `- **${label}:** ${value}`;

function line(label: string, m: Metric<number>, suffix = ''): string {
  if (!m.available) return bullet(label, T.notAvailable({ reason: m.reason }));
  const cmp =
    m.previous !== undefined
      ? ` · ${T.mdVsPrevious({ change: formatComparison(compare(m.value, m.previous)) })}`
      : '';
  return bullet(label, `${formatMetric(m, suffix)}${cmp}`);
}

function breakdown(label: string, m: Metric<Record<string, number>>): string {
  if (!m.available) return bullet(label, T.notAvailable({ reason: m.reason }));
  const entries = Object.entries(m.value).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return bullet(label, T.none());
  return bullet(label, entries.map(([k, v]) => `${humanise(k)} ${fmtNum(v)}`).join(', '));
}

export const periodLabel = (d: Pick<ReportData, 'period' | 'timezone'>) =>
  `${formatInZone(new Date(d.period.start), d.timezone)} – ${formatInZone(new Date(d.period.end), d.timezone)} (${d.timezone})`;

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const row = (...cells: string[]) => `| ${cells.join(' | ')} |`;

/** Full Markdown report: the 8 sections in the fixed order. */
export function renderMarkdown(d: ReportData, title = T.reportDefaultTitle()): string {
  const c = d.community;
  const r = d.referrals;
  const m = d.moderation;
  const i = d.infrastructure;
  const k = d.marketing;
  const o = d.outstanding;
  const na = T.na();
  const none = T.none();
  const L: string[] = [];
  L.push(
    `# ${T.mdTitle({ title: cell(title) })}`,
    '',
    T.mdPeriod({ period: periodLabel(d) }),
    T.mdGenerated({ time: formatInZone(new Date(d.generatedAt), d.timezone) }),
    '',
  );

  L.push(`## ${T.mdHeadingSummary()}`, '', ...d.summary.map((b) => `- ${b}`), '');

  L.push(`## ${T.mdHeadingCommunity()}`, '', `_${T.activityNote()}_`, '');
  L.push(
    line(T.mdTotalMembers(), c.totalMembers),
    line(T.mdJoins(), c.joins),
    line(T.mdLeaves(), c.leaves),
    line(T.mdNetGrowth(), c.netGrowth),
  );
  L.push(line(T.mdActiveMembers(), c.activeMembers), line(T.mdMessages(), c.messages));
  L.push(line(T.mdDau(), c.dau), line(T.mdWau(), c.wau), line(T.mdMau(), c.mau));
  if (c.topChannels.available) {
    L.push(
      bullet(
        T.mdTopChannels(),
        c.topChannels.value.length
          ? c.topChannels.value
              .map((t) => T.mdChannelEntry({ channelId: t.channelId, count: fmtNum(t.messages) }))
              .join(', ')
          : none,
      ),
    );
  } else L.push(bullet(T.mdTopChannels(), T.notAvailable({ reason: c.topChannels.reason })));
  L.push('');

  L.push(`## ${T.mdHeadingSupport()}`, '', `- ${T.supportNote()}`, '');

  L.push(`## ${T.mdHeadingInfrastructure()}`, '');
  L.push(
    line(T.mdIncidentsOpened(), i.incidentsOpened),
    line(T.mdIncidentsResolved(), i.incidentsResolved),
    breakdown(T.mdBySeverity(), i.incidentsBySeverity),
  );
  if (i.incidentMinutes.available) {
    const cmp =
      i.incidentMinutes.previous !== undefined
        ? ` · ${T.mdVsPreviousMinutes({ change: formatComparison(compare(i.incidentMinutes.value, i.incidentMinutes.previous)) })}`
        : '';
    L.push(bullet(T.mdTotalIncidentTime(), `${formatDuration(i.incidentMinutes.value * 60_000)}${cmp}`));
  } else L.push(bullet(T.mdTotalIncidentTime(), T.notAvailable({ reason: i.incidentMinutes.reason })));
  L.push(line(T.mdAutoDetected(), i.autoIncidents), line(T.mdManuallyDeclared(), i.manualIncidents));
  if (i.uptime.length === 0) L.push(bullet(T.mdUptime(), T.notAvailable({ reason: T.mdNoPublicServices() })));
  else {
    L.push('', row(T.mdColService(), T.mdColUptime(), T.mdColChecks()), '| --- | --- | --- |');
    for (const s of i.uptime)
      L.push(row(cell(s.name), s.uptimePct === null ? T.noData() : `${s.uptimePct}%`, fmtNum(s.checks)));
  }
  L.push('');

  L.push(`## ${T.mdHeadingModeration()}`, '');
  L.push(line(T.mdModerationActions(), m.actions), breakdown(T.mdByType(), m.actionsByType));
  L.push(
    line(T.mdAutomodDetections(), m.automodDetections),
    breakdown(T.mdByRule(), m.automodByRule),
    line(T.mdAutomodFalsePositives(), m.automodFalsePositives),
  );
  L.push(
    line(T.mdReportsReceived(), m.reportsReceived),
    line(T.mdReportsResolved(), m.reportsResolved),
    line(T.mdReportsDismissed(), m.reportsDismissed),
  );
  L.push(
    breakdown(T.mdReportsByCategory(), m.reportsByCategory),
    line(T.mdOpenBacklog(), m.openReportBacklog),
    '',
  );

  L.push(`## ${T.mdHeadingMarketing()}`, '');
  L.push(
    line(T.mdAnnouncementsPublished(), k.announcementsPublished),
    line(T.mdAnnouncementReactions(), k.announcementReactions),
  );
  L.push(line(T.mdTrackedClicks(), k.trackedLinkClicks));
  L.push(
    line(T.mdPartnerApplications(), k.partnerApplications),
    breakdown(T.mdApplicationsByStatus(), k.partnerApplicationsByStatus),
  );
  L.push(
    line(T.mdEventRsvps(), k.eventRsvps),
    line(T.mdGiveawayEntries(), k.giveawayEntries),
    line(T.mdPollBallots(), k.pollBallots),
    line(T.mdSuggestionsCreated(), k.suggestionsCreated),
  );
  L.push(
    line(T.mdReferralJoins(), r.attributedJoins),
    line(T.mdReferralsConfirmed(), r.confirmed),
    line(T.mdReferralsAmbiguous(), r.ambiguous),
    line(T.mdReferralsUnknown(), r.unknown),
    line(T.mdReferralsFlagged(), r.flagged),
  );
  if (r.topReferrers.available) {
    L.push(
      bullet(
        T.mdTopReferrers(),
        r.topReferrers.value.length
          ? r.topReferrers.value
              .map((t) => T.mdReferrerEntry({ userId: t.userId, count: t.validConfirmed }))
              .join(', ')
          : none,
      ),
    );
  } else L.push(bullet(T.mdTopReferrersUnavailable(), T.notAvailable({ reason: r.topReferrers.reason })));
  L.push('');

  L.push(
    `## ${T.mdHeadingOutstanding()}`,
    '',
    T.mdAsOf({ time: formatInZone(new Date(o.asOf), d.timezone) }),
    '',
  );
  L.push(bullet(T.mdStaleReports(), String(o.staleAbuseReports)));
  L.push(
    bullet(
      T.mdActiveIncidents(),
      o.activeIncidents.length
        ? o.activeIncidents.map((a) => `${a.ref} ${cell(a.title)} (${humanise(a.severity)})`).join('; ')
        : none,
    ),
  );
  L.push(bullet(T.mdDeadJobs(), String(o.deadJobs)));
  L.push(bullet(T.mdFlaggedReferrals(), String(o.flaggedReferrals)));
  L.push(bullet(T.mdStalePartnerApps(), String(o.stalePartnerApplications)), '');

  L.push(
    `## ${T.mdHeadingComparison()}`,
    '',
    T.mdPreviousPeriod({
      start: formatInZone(new Date(d.previousPeriod.start), d.timezone),
      end: formatInZone(new Date(d.previousPeriod.end), d.timezone),
    }),
    '',
  );
  L.push(
    row(T.mdColMetric(), T.mdColThisPeriod(), T.mdColPrevious(), T.mdColChange()),
    '| --- | --- | --- | --- |',
  );
  for (const x of d.flat.filter((f) => !f.breakdown)) {
    if (!x.available) L.push(row(cell(x.label), T.notAvailable({ reason: cell(x.note ?? '') }), na, na));
    else
      L.push(
        row(
          cell(x.label),
          fmtNum(x.value!),
          x.previous === null ? na : fmtNum(x.previous),
          formatComparison(x),
        ),
      );
  }
  L.push('');
  return L.join('\n');
}

// ── Export formats ─────────────────────────────────────────────────────────

/**
 * RFC 4180 field escaping plus spreadsheet formula-injection protection: text fields
 * starting with = + - @ tab or CR are prefixed with an apostrophe.
 */
export function csvField(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(flat: readonly FlatMetric[]): string {
  const header = [
    'section',
    'metric',
    'label',
    'available',
    'value',
    'previous',
    'delta',
    'delta_pct',
    'note',
  ];
  const rows = flat.map((r) =>
    [r.section, r.key, r.label, r.available, r.value, r.previous, r.delta, r.pct, r.note]
      .map(csvField)
      .join(','),
  );
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}
