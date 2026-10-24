import { afterAll, describe, expect, it } from 'vitest';
import { analytics } from '@gynx/services';
import { ctxAs, freshGuild, snowflake, testDb, testDeps } from './helpers';

const db = () => testDb();
const DAY = 86_400_000;

async function seedCommunityData(guildId: string, now: Date) {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
  await db().memberEvent.createMany({
    data: [
      { guildId, userId: snowflake(), type: 'JOIN', at: at(1) },
      { guildId, userId: snowflake(), type: 'JOIN', at: at(2) },
      { guildId, userId: snowflake(), type: 'JOIN', at: at(3) },
      { guildId, userId: snowflake(), type: 'LEAVE', at: at(2) },
      { guildId, userId: snowflake(), type: 'JOIN', at: at(9) }, // previous period
    ],
  });
  await db().moderationAction.create({
    data: { guildId, number: 1, ref: 'M-0001', type: 'WARN', targetId: snowflake(), moderatorId: snowflake(), reason: 'spam', createdAt: at(1) },
  });
  await db().abuseReport.create({
    data: { guildId, number: 1, ref: 'R-0001', category: 'SPAM_PHISHING', reporterId: snowflake(), description: 'x'.repeat(30), createdAt: at(4) },
  });
  const svc = await db().monitoredService.create({ data: { guildId, name: 'EU Nodes', slug: 'eu', public: true } });
  await db().healthCheck.createMany({
    data: [
      { serviceId: svc.id, ok: true, checkedAt: at(1) },
      { serviceId: svc.id, ok: true, checkedAt: at(1.5) },
      { serviceId: svc.id, ok: true, checkedAt: at(2) },
      { serviceId: svc.id, ok: false, checkedAt: at(2.5) },
    ],
  });
  await db().incident.create({
    data: { guildId, number: 1, ref: 'INC-0001', title: 'EU outage', description: 'd', severity: 'MAJOR', status: 'RESOLVED', startedAt: at(2), resolvedAt: new Date(at(2).getTime() + 30 * 60_000), createdById: snowflake() },
  });
}

describe('analytics: activity collection', () => {
  afterAll(async () => {
    await db().$disconnect();
  });

  it('accumulates counts across flushes and merges duplicate keys in one batch', async () => {
    const guildId = await freshGuild();
    const ch = snowflake();
    const u = snowflake();
    await analytics.flushActivity(db(), guildId, {
      channels: [
        { date: '2026-10-24', channelId: ch, count: 3 },
        { date: '2026-10-24', channelId: ch, count: 2 },
      ],
      users: [{ date: '2026-10-24', userId: u, count: 5 }],
    });
    await analytics.flushActivity(db(), guildId, { channels: [{ date: '2026-10-24', channelId: ch, count: 4 }], users: [{ date: '2026-10-24', userId: u, count: 4 }] });
    // invalid rows are ignored rather than stored
    await analytics.flushActivity(db(), guildId, { channels: [{ date: 'bogus', channelId: ch, count: 1 }], users: [{ date: '2026-10-24', userId: 'not-an-id', count: 1 }] });

    const c = await db().channelActivityDaily.findMany({ where: { guildId } });
    const usr = await db().userActivityDaily.findMany({ where: { guildId } });
    expect(c).toEqual([{ guildId, date: '2026-10-24', channelId: ch, messageCount: 9 }]);
    expect(usr).toEqual([{ guildId, date: '2026-10-24', userId: u, messageCount: 9 }]);
  });

  it('records member-count snapshots', async () => {
    const guildId = await freshGuild();
    const at = new Date('2026-10-24T10:00:00Z');
    await analytics.recordMemberCount(db(), guildId, 1234, at);
    const g = await db().guild.findUniqueOrThrow({ where: { id: guildId } });
    expect(g.memberCount).toBe(1234);
    expect(g.memberCountAt?.toISOString()).toBe(at.toISOString());
  });
});

describe('analytics: daily rollup', () => {
  it('is idempotent and preserves end-of-day snapshots for past days', async () => {
    const guildId = await freshGuild();
    const tz = 'Europe/London';
    const now = new Date('2026-10-24T12:00:00Z');
    await db().guild.update({ where: { id: guildId }, data: { memberCount: 500, memberCountAt: now } });
    await db().trackedLink.create({ data: { guildId, slug: `l${snowflake()}`, targetUrl: 'https://gynx.gg', clicks: 10, createdById: snowflake() } });
    await db().memberEvent.createMany({ data: [{ guildId, userId: snowflake(), type: 'JOIN', at: new Date('2026-10-24T09:00:00Z') }] });
    await analytics.flushActivity(db(), guildId, { channels: [{ date: '2026-10-24', channelId: snowflake(), count: 7 }], users: [{ date: '2026-10-24', userId: snowflake(), count: 7 }] });

    await analytics.runDailyRollup(db(), guildId, tz, now);
    await analytics.runDailyRollup(db(), guildId, tz, now);
    const rows = await db().analyticsDaily.findMany({ where: { guildId }, orderBy: { date: 'asc' } });
    expect(rows.map((r) => r.date)).toEqual(['2026-10-23', '2026-10-24']);
    const today = rows[1]!.metrics as unknown as analytics.DailyMetrics;
    expect(today).toMatchObject({ messages: 7, activeUsers: 1, joins: 1, memberCount: 500, trackedLinkClicksTotal: 10 });

    // Next day: 24th is now "yesterday" → counters recomputed, snapshot preserved despite new clicks.
    await db().trackedLink.updateMany({ where: { guildId }, data: { clicks: 25 } });
    await analytics.runDailyRollup(db(), guildId, tz, new Date('2026-10-25T01:00:00Z'));
    const after = await db().analyticsDaily.findUniqueOrThrow({ where: { guildId_date: { guildId, date: '2026-10-24' } } });
    expect((after.metrics as unknown as analytics.DailyMetrics).trackedLinkClicksTotal).toBe(10);
    const t25 = await db().analyticsDaily.findUniqueOrThrow({ where: { guildId_date: { guildId, date: '2026-10-25' } } });
    expect((t25.metrics as unknown as analytics.DailyMetrics).trackedLinkClicksTotal).toBe(25);
    expect(await db().analyticsDaily.count({ where: { guildId } })).toBe(3);
  });
});

describe('analytics: report generation', () => {
  it('produces all 8 sections, labels unavailable metrics and is idempotent per period', async () => {
    const guildId = await freshGuild();
    const now = new Date('2026-10-26T09:00:00Z');
    const deps = testDeps({ now: () => now });
    await seedCommunityData(guildId, now);
    const ch = snowflake();
    const users = [snowflake(), snowflake(), snowflake()];
    await analytics.flushActivity(db(), guildId, {
      channels: [
        { date: '2026-10-21', channelId: ch, count: 10 },
        { date: '2026-10-22', channelId: ch, count: 5 },
      ],
      users: [
        { date: '2026-10-21', userId: users[0]!, count: 8 },
        { date: '2026-10-21', userId: users[1]!, count: 2 },
        { date: '2026-10-22', userId: users[2]!, count: 5 },
      ],
    });
    await db().guildConfig.update({ where: { guildId }, data: { activeMemberMinMessages: 3 } });

    const admin = ctxAs(guildId, ['settings.manage', 'analytics.view'], { deps });
    const def = await analytics.createReportDefinition(admin, { name: 'Weekly CEO report', day: 'MONDAY', time: '09:00', timezone: 'UTC', periodDays: 7, channelId: snowflake() });
    const period = analytics.reportPeriodFor(now, 7, 'UTC');

    const first = await analytics.generateReport(db(), def, period, now);
    const second = await analytics.generateReport(db(), def, period, now);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.report.id).toBe(first.report.id);
    expect(await db().generatedReport.count({ where: { definitionId: def.id } })).toBe(1);

    const md = first.report.markdown;
    for (const h of ['## 1. Executive summary', '## 2. Community growth', '## 3. Support', '## 4. Infrastructure incidents', '## 5. Moderation & security trends', '## 6. Announcements & referral results', '## 7. Outstanding issues requiring attention', '## 8. Comparison vs previous period']) {
      expect(md).toContain(h);
    }
    expect(md).toContain(analytics.SUPPORT_NOTE);
    expect(md).toContain('Not available — no giveaways have been created yet');
    expect(md).toContain('Not available — no referral attributions have been recorded yet');

    const data = first.report.data as unknown as analytics.ReportData;
    expect(data.community.joins).toMatchObject({ available: true, value: 3, previous: 1 });
    expect(data.community.leaves).toMatchObject({ available: true, value: 1 });
    expect(data.community.netGrowth).toMatchObject({ available: true, value: 2 });
    expect(data.community.messages).toMatchObject({ available: true, value: 15 });
    expect(data.community.activeMembers).toMatchObject({ available: true, value: 2 }); // ≥ 3 messages
    expect(data.moderation.actions).toMatchObject({ available: true, value: 1 });
    expect(data.moderation.openReportBacklog).toMatchObject({ available: true, value: 1 });
    expect(data.infrastructure.incidentMinutes).toMatchObject({ available: true, value: 30 });
    expect(data.infrastructure.uptime[0]).toMatchObject({ name: 'EU Nodes', uptimePct: 75, checks: 4 });
    expect(data.marketing.giveawayEntries.available).toBe(false);
    expect(data.summary.length).toBeGreaterThanOrEqual(3);
    expect(await db().analyticsWeekly.count({ where: { guildId } })).toBe(1);
  });

  it('exports markdown, json and csv with analytics.export and audits it', async () => {
    const guildId = await freshGuild();
    const now = new Date('2026-10-26T09:00:00Z');
    const deps = testDeps({ now: () => now });
    const admin = ctxAs(guildId, ['settings.manage'], { deps });
    const def = await analytics.createReportDefinition(admin, { name: 'Weekly', day: 'MONDAY', time: '09:00', timezone: 'UTC' });
    const { report } = await analytics.generateReport(db(), def, analytics.reportPeriodFor(now, 7, 'UTC'), now);

    const exporter = ctxAs(guildId, ['analytics.view', 'analytics.export'], { deps });
    const csv = await analytics.exportReport(exporter, report.id, 'csv');
    expect(csv.filename).toMatch(/\.csv$/);
    expect(csv.content.split('\r\n')[0]).toBe('section,metric,label,available,value,previous,delta,delta_pct,note');
    const json = await analytics.exportReport(exporter, report.id, 'json');
    expect(JSON.parse(json.content).version).toBe(1);
    const md = await analytics.exportReport(exporter, report.id, 'markdown');
    expect(md.content).toContain('## 8. Comparison vs previous period');
    expect(await db().securityAuditEvent.count({ where: { guildId, action: 'analytics.export', result: 'SUCCESS' } })).toBe(3);

    const list = await analytics.listReports(exporter, {});
    expect(list.items).toHaveLength(1);
    expect('markdown' in list.items[0]!).toBe(false);
    const other = await freshGuild();
    await expect(analytics.getReport(ctxAs(other, ['analytics.view']), report.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('analytics: permissions', () => {
  it('denies members and view-only staff where appropriate', async () => {
    const guildId = await freshGuild();
    const member = ctxAs(guildId);
    await expect(analytics.getOverview(member, '7d')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(analytics.staffStats(member, '7d')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(analytics.listReports(member, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(analytics.getSettings(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(analytics.updateSettings(member, { timezone: 'Europe/London' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const viewer = ctxAs(guildId, ['analytics.view']);
    await expect(analytics.exportReport(viewer, 'nope', 'csv')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(analytics.createReportDefinition(viewer, { name: 'x', day: 'MONDAY', time: '09:00', timezone: 'UTC' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const overview = await analytics.getOverview(viewer, '30d');
    expect(overview.community.joins.available).toBe(false); // no MemberEvents ever → not 0
    expect(await db().securityAuditEvent.count({ where: { guildId, result: 'DENIED' } })).toBeGreaterThanOrEqual(5);
  });

  it('respects a disabled analytics module', async () => {
    const guildId = await freshGuild();
    await db().guildConfig.update({ where: { guildId }, data: { enabledModules: ['status'] } });
    await expect(analytics.getOverview(ctxAs(guildId, ['analytics.view']), '7d')).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });

  it('computes staff stats as counts per staff member', async () => {
    const guildId = await freshGuild();
    const now = new Date();
    const mod = snowflake();
    await db().moderationAction.createMany({
      data: [
        { guildId, number: 1, ref: 'M-0001', type: 'WARN', targetId: snowflake(), moderatorId: mod, reason: 'r', createdAt: now },
        { guildId, number: 2, ref: 'M-0002', type: 'TIMEOUT', targetId: snowflake(), moderatorId: mod, reason: 'r', createdAt: now },
        { guildId, number: 3, ref: 'M-0003', type: 'MESSAGE_DELETE', targetId: snowflake(), moderatorId: 'automod', reason: 'r', createdAt: now },
      ],
    });
    const stats = await analytics.staffStats(ctxAs(guildId, ['analytics.view']), '7d');
    expect(stats.rows).toEqual([{ userId: mod, moderationActions: 2, reportsClaimed: 0, reportsResolved: 0, incidentUpdates: 0, partnerReviews: 0, total: 2 }]);
  });
});

describe('analytics: settings', () => {
  it('validates input and rejects unsafe configurations', async () => {
    const guildId = await freshGuild();
    const admin = ctxAs(guildId, ['settings.manage', 'permissions.manage']);
    await expect(analytics.updateSettings(admin, { timezone: 'Mars/Olympus' })).rejects.toThrow();
    await expect(analytics.updateSettings(admin, { retention: { auditDays: 30 } })).rejects.toThrow();
    await expect(analytics.updateSettings(admin, { supportUrl: 'http://support.example.com' })).rejects.toThrow();
    await expect(analytics.updateSettings(admin, { embedFooter: 'x'.repeat(101) })).rejects.toThrow();
    await expect(analytics.updateSettings(admin, { enabledModules: ['tickets' as never] })).rejects.toThrow();
    await expect(analytics.updateSettings(admin, { channels: { report: 'abc' } })).rejects.toThrow();
    await expect(analytics.updateSettings(admin, { unknownKey: 1 } as never)).rejects.toThrow();
    await expect(analytics.updateSettings(admin, { roles: { staffPing: guildId } })).rejects.toMatchObject({ code: 'VALIDATION' });

    const shared = snowflake();
    await expect(analytics.updateSettings(admin, { channels: { announcement: shared, security: shared } })).rejects.toMatchObject({ code: 'VALIDATION' });

    const staffRole = snowflake();
    await analytics.updateSettings(admin, { roles: { staffPing: staffRole } });
    await expect(analytics.updateSettings(admin, { roles: { partner: staffRole } })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const privilegedRole = snowflake();
    await db().staffPermission.create({ data: { guildId, subjectType: 'ROLE', subjectId: privilegedRole, permission: 'ADMINISTRATOR', createdById: admin.actor.userId } });
    await expect(analytics.updateSettings(admin, { roles: { partner: privilegedRole } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('updates settings, syncs the report schedule and audits only changed keys', async () => {
    const guildId = await freshGuild();
    const now = new Date('2026-10-21T12:00:00Z');
    const admin = ctxAs(guildId, ['settings.manage'], { deps: testDeps({ now: () => now }) });
    const reportChannel = snowflake();
    const s = await analytics.updateSettings(admin, {
      timezone: 'Europe/London',
      channels: { report: reportChannel },
      supportUrl: 'https://support.gynx.gg',
      activeMemberMinMessages: 3,
      embedFooter: 'GYNX.GG', // unchanged default → not audited
      reportSchedule: { day: 'MONDAY', time: '09:00' },
    });
    expect(s.timezone).toBe('Europe/London');
    expect(s.channels.report).toBe(reportChannel);
    expect(s.reportSchedule).toMatchObject({ day: 'MONDAY', time: '09:00', timezone: 'Europe/London', channelId: reportChannel, nextRunAt: '2026-10-26T09:00:00.000Z' });

    const ev = await db().securityAuditEvent.findFirstOrThrow({ where: { guildId, action: 'settings.update' } });
    const meta = ev.metadata as { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> };
    expect(meta.changed.sort()).toEqual(['activeMemberMinMessages', 'reportChannelId', 'supportUrl', 'timezone']);
    expect(meta.before.timezone).toBe('UTC');
    expect(meta.after.timezone).toBe('Europe/London');
    expect(meta.before).not.toHaveProperty('embedFooter');

    // Module toggle
    const s2 = await analytics.updateSettings(admin, { enabledModules: ['status', 'analytics'] });
    expect(s2.enabledModules).toEqual(['status', 'analytics']);

    // No-op update writes no audit event
    const before = await db().securityAuditEvent.count({ where: { guildId, action: 'settings.update' } });
    await analytics.updateSettings(admin, { timezone: 'Europe/London' });
    expect(await db().securityAuditEvent.count({ where: { guildId, action: 'settings.update' } })).toBe(before);
  });

  it('validates report definitions', async () => {
    const guildId = await freshGuild();
    const admin = ctxAs(guildId, ['settings.manage']);
    await expect(analytics.createReportDefinition(admin, { name: 'a', day: 'FUNDAY' as never, time: '09:00', timezone: 'UTC' })).rejects.toThrow();
    await expect(analytics.createReportDefinition(admin, { name: 'a', day: 'MONDAY', time: '25:00', timezone: 'UTC' })).rejects.toThrow();
    await expect(analytics.createReportDefinition(admin, { name: 'a', day: 'MONDAY', time: '09:00', timezone: 'Nowhere/City' })).rejects.toThrow();
    await expect(analytics.createReportDefinition(admin, { name: 'a', day: 'MONDAY', time: '09:00', timezone: 'UTC', periodDays: 32 })).rejects.toThrow();
    await expect(analytics.createReportDefinition(admin, { name: 'a', day: 'MONDAY', time: '09:00', timezone: 'UTC', channelId: '123' })).rejects.toThrow();
    const def = await analytics.createReportDefinition(admin, { name: 'Monthly', day: 'MONDAY', time: '09:00', timezone: 'UTC', periodDays: 30 });
    await expect(analytics.createReportDefinition(admin, { name: 'Monthly', day: 'MONDAY', time: '09:00', timezone: 'UTC' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const upd = await analytics.updateReportDefinition(admin, def.id, { enabled: false });
    expect(upd.nextRunAt).toBeNull();
    await analytics.deleteReportDefinition(admin, def.id);
    expect(await db().reportDefinition.count({ where: { guildId } })).toBe(0);
  });
});
