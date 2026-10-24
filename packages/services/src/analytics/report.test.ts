import { describe, expect, it } from 'vitest';
import type { CommunitySection, InfrastructureSection, MarketingSection, ModerationSection, OutstandingSection, ReferralSection } from './collect';
import { available, unavailable, type Metric } from './metrics';
import { csvField, executiveSummary, flattenMetrics, renderMarkdown, SUPPORT_NOTE, toCsv, type ReportData } from './report';
import { reportEmbeds } from './render';

const n = (value: number, previous?: number): Metric<number> => (previous === undefined ? available(value) : { available: true, value, previous });
const na = unavailable<never>('no data has been recorded yet');

function fixture(overrides: Partial<Omit<ReportData, 'summary' | 'flat'>> = {}): Omit<ReportData, 'summary' | 'flat'> {
  const community: CommunitySection = {
    totalMembers: available(1500, 'snapshot at 26 Oct 2026, 08:00'),
    joins: n(40, 20),
    leaves: n(10, 10),
    netGrowth: n(30, 10),
    activeMembers: n(200, 180),
    messages: n(5000, 4000),
    topChannels: available([{ channelId: '111111111111111111', messages: 900 }]),
    dau: n(55.5, 50),
    wau: n(200, 190),
    mau: n(600),
    activeMemberThreshold: 1,
    activityDays: 7,
  };
  const referrals: ReferralSection = { attributedJoins: na, confirmed: na, ambiguous: na, unknown: na, flagged: na, topReferrers: na };
  const moderation: ModerationSection = {
    actions: n(8, 4),
    actionsByType: { available: true, value: { WARN: 5, TIMEOUT: 3 }, previous: { WARN: 4 } },
    automodDetections: n(12, 12),
    automodByRule: available({ PHISHING: 12 }),
    automodFalsePositives: n(1, 0),
    reportsReceived: n(3, 1),
    reportsResolved: n(2, 1),
    reportsDismissed: n(0, 0),
    reportsByCategory: available({ SPAM_PHISHING: 3 }),
    openReportBacklog: n(4, 2),
  };
  const infrastructure: InfrastructureSection = {
    incidentsOpened: n(2, 0),
    incidentsResolved: n(2, 0),
    incidentsBySeverity: available({ MAJOR: 1, MINOR: 1 }),
    incidentMinutes: n(95, 0),
    autoIncidents: n(1, 0),
    manualIncidents: n(1, 0),
    uptime: [
      { serviceId: 's1', name: 'EU Game Nodes', checks: 1000, uptimePct: 99.5 },
      { serviceId: 's2', name: 'Website', checks: 0, uptimePct: null },
    ],
  };
  const marketing: MarketingSection = {
    announcementsPublished: n(3, 2),
    announcementReactions: unavailable('not available — no delivered announcements with reaction data in this period'),
    trackedLinkClicks: available(140, 'first period, cumulative'),
    partnerApplications: n(2),
    partnerApplicationsByStatus: available({ PENDING: 2 }),
    eventRsvps: na,
    giveawayEntries: na,
    pollBallots: na,
    suggestionsCreated: n(6, 3),
  };
  const outstanding: OutstandingSection = {
    asOf: '2026-10-26T09:00:00.000Z',
    staleAbuseReports: 1,
    activeIncidents: [{ ref: 'INC-0003', title: 'EU latency', severity: 'MINOR', startedAt: '2026-10-25T09:00:00.000Z' }],
    deadJobs: 2,
    flaggedReferrals: 0,
    stalePartnerApplications: 0,
  };
  return {
    version: 1,
    guildId: '1',
    timezone: 'Europe/London',
    period: { start: '2026-10-19T08:00:00.000Z', end: '2026-10-26T09:00:00.000Z' },
    previousPeriod: { start: '2026-10-12T07:00:00.000Z', end: '2026-10-19T08:00:00.000Z' },
    generatedAt: '2026-10-26T09:00:05.000Z',
    community,
    referrals,
    moderation,
    infrastructure,
    marketing,
    outstanding,
    ...overrides,
  };
}

function build(overrides: Partial<Omit<ReportData, 'summary' | 'flat'>> = {}): ReportData {
  const base = fixture(overrides);
  const flat = flattenMetrics(base);
  return { ...base, flat, summary: executiveSummary(base, flat) };
}

describe('flat metric table', () => {
  it('flattens scalars with comparisons and breakdowns per entry', () => {
    const flat = flattenMetrics(fixture());
    const joins = flat.find((r) => r.key === 'community.joins')!;
    expect(joins).toMatchObject({ value: 40, previous: 20, delta: 20, pct: 100, available: true });
    const warn = flat.find((r) => r.key === 'moderation.actionsByType.WARN')!;
    expect(warn).toMatchObject({ value: 5, previous: 4, breakdown: true });
    const timeout = flat.find((r) => r.key === 'moderation.actionsByType.TIMEOUT')!;
    expect(timeout).toMatchObject({ value: 3, previous: 0, pct: null });
    const rsvp = flat.find((r) => r.key === 'marketing.eventRsvps')!;
    expect(rsvp).toMatchObject({ available: false, value: null, note: 'no data has been recorded yet' });
    const fp = flat.find((r) => r.key === 'moderation.automodFalsePositives')!;
    expect(fp.pct).toBeNull(); // previous 0 → n/a
  });
});

describe('executive summary', () => {
  it('produces 3–6 data-driven bullets', () => {
    const d = build();
    expect(d.summary.length).toBeGreaterThanOrEqual(3);
    expect(d.summary.length).toBeLessThanOrEqual(6);
    expect(d.summary[0]).toContain('net growth of +30 members');
    expect(d.summary.some((b) => b.includes('2 incidents opened (1 major/critical)'))).toBe(true);
    expect(d.summary.some((b) => b.startsWith('Security: 4 open abuse reports (1 older than 72h)'))).toBe(true);
    expect(d.summary.some((b) => b.startsWith('Needs attention:') && b.includes('1 active incident') && b.includes('2 failed background jobs'))).toBe(true);
    expect(d.summary.some((b) => b === 'Notable change: Net member growth up 200% to 30 (from 10).')).toBe(true);
  });

  it('still produces at least 3 bullets when nearly everything is unavailable', () => {
    const base = fixture();
    const empty = Object.fromEntries(Object.keys(base.community).map((k) => [k, na])) as unknown as CommunitySection;
    const d = build({
      community: { ...empty, activeMemberThreshold: 1, activityDays: 7 },
      moderation: Object.fromEntries(Object.keys(base.moderation).map((k) => [k, na])) as unknown as ModerationSection,
      infrastructure: { ...(Object.fromEntries(Object.keys(base.infrastructure).map((k) => [k, na])) as unknown as InfrastructureSection), uptime: [] },
      outstanding: { ...base.outstanding, activeIncidents: [], deadJobs: 0, staleAbuseReports: 0 },
    });
    expect(d.summary.length).toBeGreaterThanOrEqual(3);
    expect(d.summary.some((b) => b.startsWith('Data coverage:'))).toBe(true);
  });
});

describe('markdown report', () => {
  it('contains all 8 sections in order and labels unavailable metrics', () => {
    const md = renderMarkdown(build());
    const headings = [...md.matchAll(/^## (\d)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`);
    expect(headings).toEqual([
      '1. Executive summary',
      '2. Community growth',
      '3. Support',
      '4. Infrastructure incidents',
      '5. Moderation & security trends',
      '6. Announcements & referral results',
      '7. Outstanding issues requiring attention',
      '8. Comparison vs previous period',
    ]);
    expect(md).toContain(SUPPORT_NOTE);
    expect(md).toContain('Not available — no data has been recorded yet');
    expect(md).toContain('| Website | no data | 0 |');
    expect(md).toContain('first period, cumulative');
    expect(md).toContain('observed message activity');
    expect(md).not.toMatch(/ticket/i);
  });

  it('renders a delivery embed within Discord limits', () => {
    const [e] = reportEmbeds(build(), { dashboardUrl: 'https://dash.test', reportId: 'r1' });
    expect(e!.url).toBe('https://dash.test/analytics/reports/r1');
    expect(e!.fields!.length).toBeLessThanOrEqual(25);
    expect(JSON.stringify(e).length).toBeLessThan(6000);
  });
});

describe('CSV export', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField(null)).toBe('');
    expect(csvField(-5)).toBe('-5');
  });
  it('neutralises spreadsheet formulas in text cells', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('-1+1')).toBe("'-1+1");
  });
  it('produces a header and one row per flat metric', () => {
    const d = build();
    const csv = toCsv(d.flat);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('section,metric,label,available,value,previous,delta,delta_pct,note');
    expect(lines).toHaveLength(d.flat.length + 1);
    expect(lines.find((l) => l.startsWith('community,community.joins,'))).toBe('community,community.joins,Joins,true,40,20,20,100,');
  });
});
