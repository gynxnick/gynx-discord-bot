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
import { compare, fmtNum, formatComparison, formatMetric, previousPeriod, type Metric, type Period } from './metrics';

export const SUPPORT_NOTE = 'Support metrics: handled in the external support system (not tracked by the bot)';
export const ACTIVITY_NOTE = 'Community activity figures are observed message activity only — Discord provides no view or impression data.';

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
      rows.push({ ...base, label: def.label, available: false, value: null, previous: null, delta: null, pct: null, note: m.reason, breakdown: false });
      continue;
    }
    if (typeof m.value === 'number') {
      const prev = typeof m.previous === 'number' ? m.previous : null;
      const c = compare(m.value, prev);
      rows.push({ ...base, label: def.label, available: true, value: m.value, previous: prev, ...c, note: m.note ?? null, breakdown: false });
      continue;
    }
    if (m.value && typeof m.value === 'object' && !Array.isArray(m.value)) {
      const cur = m.value as Record<string, number>;
      const prev = (m.previous ?? null) as Record<string, number> | null;
      const keys = [...new Set([...Object.keys(cur), ...Object.keys(prev ?? {})])].sort();
      for (const k of keys) {
        const v = cur[k] ?? 0;
        const p = prev ? (prev[k] ?? 0) : null;
        rows.push({ ...base, key: `${base.key}.${k}`, label: `${def.label}: ${humanise(k)}`, available: true, value: v, previous: p, ...compare(v, p), note: null, breakdown: true });
      }
    }
  }
  return rows;
}

export const humanise = (enumValue: string) => enumValue.charAt(0) + enumValue.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * 3–6 bullet highlights computed from the data: growth, the biggest relative changes,
 * incidents, the security backlog and anything awaiting attention.
 */
export function executiveSummary(d: Omit<ReportData, 'summary' | 'flat'>, flat: readonly FlatMetric[]): string[] {
  const out: string[] = [];
  const c = d.community;
  if (c.netGrowth.available && c.joins.available && c.leaves.available) {
    const total = c.totalMembers.available ? `; ${fmtNum(c.totalMembers.value)} members total` : '';
    out.push(`Community: net growth of ${c.netGrowth.value > 0 ? '+' : ''}${fmtNum(c.netGrowth.value)} members (${fmtNum(c.joins.value)} joins, ${fmtNum(c.leaves.value)} leaves)${total}.`);
  } else if (c.totalMembers.available) {
    out.push(`Community: ${fmtNum(c.totalMembers.value)} members (${c.totalMembers.note ?? 'latest snapshot'}); join/leave data not available.`);
  }
  if (c.activeMembers.available && c.messages.available) {
    out.push(`Activity: ${fmtNum(c.activeMembers.value)} active members sent ${fmtNum(c.messages.value)} messages (observed message activity).`);
  }

  const rest: string[] = [];
  const inf = d.infrastructure;
  if (inf.incidentsOpened.available) {
    if (inf.incidentsOpened.value === 0) rest.push('Infrastructure: no incidents were opened this period.');
    else {
      const sev = inf.incidentsBySeverity.available ? inf.incidentsBySeverity.value : {};
      const serious = (sev.CRITICAL ?? 0) + (sev.MAJOR ?? 0);
      const mins = inf.incidentMinutes.available ? `, ${formatDuration(inf.incidentMinutes.value * 60_000)} total incident time` : '';
      rest.push(`Infrastructure: ${inf.incidentsOpened.value} incident${inf.incidentsOpened.value === 1 ? '' : 's'} opened (${serious} major/critical)${mins}.`);
    }
  }

  const mod = d.moderation;
  if (mod.openReportBacklog.available) {
    rest.push(
      `Security: ${fmtNum(mod.openReportBacklog.value)} open abuse report${mod.openReportBacklog.value === 1 ? '' : 's'} (${d.outstanding.staleAbuseReports} older than 72h)` +
        (mod.reportsReceived.available ? `; ${fmtNum(mod.reportsReceived.value)} received this period.` : '.'),
    );
  }

  const o = d.outstanding;
  const attention = [
    o.activeIncidents.length ? `${o.activeIncidents.length} active incident${o.activeIncidents.length === 1 ? '' : 's'}` : null,
    o.deadJobs ? `${o.deadJobs} failed background job${o.deadJobs === 1 ? '' : 's'}` : null,
    o.flaggedReferrals ? `${o.flaggedReferrals} flagged referral${o.flaggedReferrals === 1 ? '' : 's'}` : null,
    o.stalePartnerApplications ? `${o.stalePartnerApplications} partner application${o.stalePartnerApplications === 1 ? '' : 's'} pending > 7 days` : null,
  ].filter(Boolean);
  if (attention.length) rest.push(`Needs attention: ${attention.join(', ')}.`);

  // Biggest relative changes fill the remaining room (max 2), placed after the community bullets.
  const room = Math.max(0, Math.min(2, 6 - out.length - rest.length));
  const changes = flat
    .filter((r) => !r.breakdown && r.available && r.previous !== null && r.previous > 0 && r.pct !== null && Math.abs(r.delta ?? 0) >= 3)
    .sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!))
    .slice(0, room)
    .map((r) => `Notable change: ${r.label} ${r.delta! > 0 ? 'up' : 'down'} ${Math.abs(r.pct!)}% to ${fmtNum(r.value!)} (from ${fmtNum(r.previous!)}).`);
  out.push(...changes, ...rest);

  const scalar = flat.filter((r) => !r.breakdown);
  const missing = scalar.filter((r) => !r.available).length;
  if (out.length < 3 && missing > 0) out.push(`Data coverage: ${missing} of ${scalar.length} metrics are not available for this period (see sections below).`);
  if (out.length < 3 && attention.length === 0) out.push('No outstanding issues requiring attention were detected.');
  if (out.length < 3) out.push(SUPPORT_NOTE + '.');
  return out.slice(0, 6);
}

export interface BuildReportInput {
  guildId: string;
  period: Period;
  opts: CollectOptions;
}

/** Compute every section for the period and the previous equal-length period. */
export async function buildReportData(db: Db, { guildId, period, opts }: BuildReportInput): Promise<ReportData> {
  const prev = previousPeriod(period);
  const src = await sourcePresence(db, guildId);
  const both = <S extends object>(fn: (db: Db, g: string, p: Period, o: CollectOptions, s: typeof src) => Promise<S>) =>
    Promise.all([fn(db, guildId, period, opts, src), fn(db, guildId, prev, opts, src)]).then(([c, p]) => mergeSection(c, p));

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

function line(label: string, m: Metric<number>, suffix = ''): string {
  if (!m.available) return `- **${label}:** Not available — ${m.reason}`;
  const cmp = m.previous !== undefined ? ` · vs previous: ${formatComparison(compare(m.value, m.previous))}` : '';
  return `- **${label}:** ${formatMetric(m, suffix)}${cmp}`;
}

function breakdown(label: string, m: Metric<Record<string, number>>): string {
  if (!m.available) return `- **${label}:** Not available — ${m.reason}`;
  const entries = Object.entries(m.value).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return `- **${label}:** none`;
  return `- **${label}:** ${entries.map(([k, v]) => `${humanise(k)} ${fmtNum(v)}`).join(', ')}`;
}

export const periodLabel = (d: Pick<ReportData, 'period' | 'timezone'>) =>
  `${formatInZone(new Date(d.period.start), d.timezone)} – ${formatInZone(new Date(d.period.end), d.timezone)} (${d.timezone})`;

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Full Markdown report: the 8 sections in the fixed order. */
export function renderMarkdown(d: ReportData, title = 'Weekly CEO report'): string {
  const c = d.community;
  const r = d.referrals;
  const m = d.moderation;
  const i = d.infrastructure;
  const k = d.marketing;
  const o = d.outstanding;
  const L: string[] = [];
  L.push(`# ${cell(title)} — GYNX.GG`, '', `Period: ${periodLabel(d)}`, `Generated: ${formatInZone(new Date(d.generatedAt), d.timezone)}`, '');

  L.push('## 1. Executive summary', '', ...d.summary.map((b) => `- ${b}`), '');

  L.push('## 2. Community growth', '', `_${ACTIVITY_NOTE}_`, '');
  L.push(line('Total members', c.totalMembers), line('Joins', c.joins), line('Leaves', c.leaves), line('Net growth', c.netGrowth));
  L.push(line('Active members', c.activeMembers), line('Messages', c.messages));
  L.push(line('Daily active (avg)', c.dau), line('Weekly active', c.wau), line('Monthly active', c.mau));
  if (c.topChannels.available) {
    L.push(
      `- **Top channels by messages:** ${c.topChannels.value.length ? c.topChannels.value.map((t) => `channel ${t.channelId} (${fmtNum(t.messages)})`).join(', ') : 'none'}`,
    );
  } else L.push(`- **Top channels by messages:** Not available — ${c.topChannels.reason}`);
  L.push('');

  L.push('## 3. Support', '', `- ${SUPPORT_NOTE}`, '');

  L.push('## 4. Infrastructure incidents', '');
  L.push(line('Incidents opened', i.incidentsOpened), line('Incidents resolved', i.incidentsResolved), breakdown('By severity', i.incidentsBySeverity));
  if (i.incidentMinutes.available) {
    L.push(`- **Total incident time:** ${formatDuration(i.incidentMinutes.value * 60_000)}${i.incidentMinutes.previous !== undefined ? ` · vs previous: ${formatComparison(compare(i.incidentMinutes.value, i.incidentMinutes.previous))} min` : ''}`);
  } else L.push(`- **Total incident time:** Not available — ${i.incidentMinutes.reason}`);
  L.push(line('Auto-detected', i.autoIncidents), line('Manually declared', i.manualIncidents));
  if (i.uptime.length === 0) L.push('- **Uptime:** Not available — no public monitored services');
  else {
    L.push('', '| Service | Uptime | Checks |', '| --- | --- | --- |');
    for (const s of i.uptime) L.push(`| ${cell(s.name)} | ${s.uptimePct === null ? 'no data' : `${s.uptimePct}%`} | ${fmtNum(s.checks)} |`);
  }
  L.push('');

  L.push('## 5. Moderation & security trends', '');
  L.push(line('Moderation actions', m.actions), breakdown('By type', m.actionsByType));
  L.push(line('Automod detections', m.automodDetections), breakdown('By rule', m.automodByRule), line('Automod false positives', m.automodFalsePositives));
  L.push(line('Abuse reports received', m.reportsReceived), line('Resolved', m.reportsResolved), line('Dismissed', m.reportsDismissed));
  L.push(breakdown('Reports by category', m.reportsByCategory), line('Open report backlog', m.openReportBacklog), '');

  L.push('## 6. Announcements & referral results', '');
  L.push(line('Announcements published', k.announcementsPublished), line('Announcement reactions', k.announcementReactions));
  L.push(line('Tracked link clicks', k.trackedLinkClicks));
  L.push(line('Partner applications', k.partnerApplications), breakdown('Applications by status', k.partnerApplicationsByStatus));
  L.push(line('Event RSVPs (going)', k.eventRsvps), line('Giveaway entries', k.giveawayEntries), line('Poll ballots', k.pollBallots), line('Suggestions created', k.suggestionsCreated));
  L.push(line('Referral-tracked joins', r.attributedJoins), line('Confirmed', r.confirmed), line('Ambiguous', r.ambiguous), line('Unknown source', r.unknown), line('Flagged for review', r.flagged));
  if (r.topReferrers.available) {
    L.push(`- **Top referrers (valid, confirmed):** ${r.topReferrers.value.length ? r.topReferrers.value.map((t) => `user ${t.userId} (${t.validConfirmed})`).join(', ') : 'none'}`);
  } else L.push(`- **Top referrers:** Not available — ${r.topReferrers.reason}`);
  L.push('');

  L.push('## 7. Outstanding issues requiring attention', '', `As of ${formatInZone(new Date(o.asOf), d.timezone)}:`, '');
  L.push(`- **Open abuse reports older than 72h:** ${o.staleAbuseReports}`);
  L.push(`- **Active incidents:** ${o.activeIncidents.length ? o.activeIncidents.map((a) => `${a.ref} ${cell(a.title)} (${humanise(a.severity)})`).join('; ') : 'none'}`);
  L.push(`- **Dead-letter background jobs:** ${o.deadJobs}`);
  L.push(`- **Flagged referrals awaiting review:** ${o.flaggedReferrals}`);
  L.push(`- **Partner applications pending > 7 days:** ${o.stalePartnerApplications}`, '');

  L.push('## 8. Comparison vs previous period', '', `Previous period: ${formatInZone(new Date(d.previousPeriod.start), d.timezone)} – ${formatInZone(new Date(d.previousPeriod.end), d.timezone)}`, '');
  L.push('| Metric | This period | Previous | Change |', '| --- | --- | --- | --- |');
  for (const row of d.flat.filter((x) => !x.breakdown)) {
    if (!row.available) L.push(`| ${cell(row.label)} | Not available — ${cell(row.note ?? '')} | n/a | n/a |`);
    else L.push(`| ${cell(row.label)} | ${fmtNum(row.value!)} | ${row.previous === null ? 'n/a' : fmtNum(row.previous)} | ${formatComparison(row)} |`);
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
  const header = ['section', 'metric', 'label', 'available', 'value', 'previous', 'delta', 'delta_pct', 'note'];
  const rows = flat.map((r) => [r.section, r.key, r.label, r.available, r.value, r.previous, r.delta, r.pct, r.note].map(csvField).join(','));
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}
