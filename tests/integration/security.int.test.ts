import { afterAll, describe, expect, it } from 'vitest';
import { security } from '@gynx/services';
import { ctxAs, freshGuild, snowflake, testDb, testDeps } from './helpers';

const validReport = {
  category: 'SPAM_PHISHING' as const,
  description: 'User is DMing members a fake Nitro link that steals accounts.',
  evidenceUrls: ['https://example.com/screenshot.png'],
};

describe('security: abuse reports', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('submits a report with a ref, redacts secrets and enqueues a staff notification', async () => {
    const guildId = await freshGuild();
    const member = ctxAs(guildId);
    const report = await security.submitReport(member, {
      ...validReport,
      reportedUserId: snowflake(),
      description: 'They posted my token=abcdef1234567890 in chat, please remove it ASAP.',
    });
    expect(report.ref).toBe('R-0001');
    expect(report.status).toBe('NEW');
    expect(report.description).not.toContain('abcdef1234567890');

    const job = await testDb().scheduledJob.findUnique({
      where: { dedupeKey: `security.report.notify:${report.id}` },
    });
    expect(job?.status).toBe('PENDING');

    const auditRow = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'security.report.submit' },
    });
    expect(JSON.stringify(auditRow?.metadata)).not.toContain('token');
  });

  it('rejects invalid evidence URLs and self-reports', async () => {
    const guildId = await freshGuild();
    const member = ctxAs(guildId);
    await expect(
      security.submitReport(member, { ...validReport, evidenceUrls: ['javascript:alert(1)'] }),
    ).rejects.toThrow();
    await expect(
      security.submitReport(member, { ...validReport, evidenceUrls: ['http://insecure.example.com'] }),
    ).rejects.toThrow();
    await expect(
      security.submitReport(member, { ...validReport, reportedUserId: member.actor.userId }),
    ).rejects.toThrow(/yourself/);
  });

  it('suppresses duplicate reports and rate-limits submissions', async () => {
    const guildId = await freshGuild();
    const member = ctxAs(guildId);
    const target = snowflake();
    await security.submitReport(member, { ...validReport, reportedUserId: target });
    await expect(security.submitReport(member, { ...validReport, reportedUserId: target })).rejects.toThrow(
      /already have an open report/,
    );

    // 3 per hour: the duplicate above consumed the 2nd slot; one more allowed, then rate limited.
    await security.submitReport(member, { ...validReport, category: 'HARASSMENT', reportedUserId: target });
    await expect(security.submitReport(member, { ...validReport, category: 'OTHER' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('denies report access to members and hides reporter identity from view-only staff', async () => {
    const guildId = await freshGuild();
    const reporter = ctxAs(guildId);
    const report = await security.submitReport(reporter, validReport);

    await expect(security.listReports(ctxAs(guildId), {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const denied = await testDb().securityAuditEvent.findFirst({ where: { guildId, result: 'DENIED' } });
    expect(denied).not.toBeNull();

    const viewer = await security.getReport(ctxAs(guildId, ['security.reports.view']), report.id);
    expect(viewer.report.reporterId).toBeNull();
    const manager = await security.getReport(
      ctxAs(guildId, ['security.reports.view', 'security.reports.manage']),
      report.id,
    );
    expect(manager.report.reporterId).toBe(reporter.actor.userId);
  });

  it('enforces the status workflow and notifies the reporter on closure', async () => {
    const guildId = await freshGuild();
    const report = await security.submitReport(ctxAs(guildId), validReport);
    const staff = ctxAs(guildId, ['security.reports.view', 'security.reports.manage']);

    const claimed = await security.claimReport(staff, report.id);
    expect(claimed.status).toBe('TRIAGED');
    expect(claimed.assigneeId).toBe(staff.actor.userId);

    await expect(security.updateReportStatus(staff, report.id, { status: 'RESOLVED' })).rejects.toThrow(
      /resolution summary/,
    );
    await security.updateReportStatus(staff, report.id, { status: 'INVESTIGATING' });
    await security.addReportNote(staff, report.id, 'Checked message history; confirmed phishing domain.');
    const done = await security.updateReportStatus(staff, report.id, {
      status: 'RESOLVED',
      resolution: 'User banned, domain blocked.',
    });
    expect(done.resolvedAt).not.toBeNull();
    await expect(
      security.updateReportStatus(staff, report.id, { status: 'INVESTIGATING' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const job = await testDb().scheduledJob.findUnique({
      where: { dedupeKey: `security.report.reporter-update:${report.id}` },
    });
    expect(job).not.toBeNull();
  });

  it('prevents two staff from claiming the same report concurrently', async () => {
    const guildId = await freshGuild();
    const report = await security.submitReport(ctxAs(guildId), validReport);
    const perms = ['security.reports.view', 'security.reports.manage'] as const;
    const results = await Promise.allSettled([
      security.claimReport(ctxAs(guildId, [...perms]), report.id),
      security.claimReport(ctxAs(guildId, [...perms]), report.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('purges closed reports after the retention window', async () => {
    const guildId = await freshGuild();
    const deps = testDeps();
    const report = await security.submitReport(ctxAs(guildId, [], { deps }), validReport);
    const staff = ctxAs(guildId, ['security.reports.view', 'security.reports.manage'], { deps });
    await security.updateReportStatus(staff, report.id, {
      status: 'DISMISSED',
      resolution: 'Not actionable.',
    });

    expect(await security.purgeExpiredReports(testDb(), guildId, new Date())).toBe(0);
    const later = new Date(Date.now() + 400 * 86_400_000);
    expect(await security.purgeExpiredReports(testDb(), guildId, later)).toBe(1);
  });
});
