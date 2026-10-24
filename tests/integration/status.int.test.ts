import { afterAll, describe, expect, it } from 'vitest';
import { status } from '@gynx/services';
import { ctxAs, freshGuild, snowflake, testDb, testDeps } from './helpers';

const svcInput = { name: 'Game Panel', slug: 'panel', region: 'EU-West', kind: 'HTTP' as const, target: 'https://panel-secret.example.com/health' };

describe('status: monitored services', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('denies members and staff without status.manage; audits the denial', async () => {
    const guildId = await freshGuild();
    await expect(status.createService(ctxAs(guildId), svcInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(status.createService(ctxAs(guildId, ['incidents.manage']), svcInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(status.listServices(ctxAs(guildId))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const denied = await testDb().securityAuditEvent.count({ where: { guildId, result: 'DENIED' } });
    expect(denied).toBeGreaterThanOrEqual(3);
  });

  it('creates services, rejects duplicate slugs and invalid targets', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['status.manage']);
    const s = await status.createService(staff, svcInput);
    expect(s).toMatchObject({ slug: 'panel', state: 'UNKNOWN', allowPrivate: false });
    await expect(status.createService(staff, svcInput)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(status.createService(staff, { ...svcInput, slug: 'x', target: 'gopher://x' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(status.createService(staff, { ...svcInput, slug: 'meta', target: 'http://169.254.169.254/' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(status.createService(staff, { ...svcInput, slug: 'tcp', kind: 'TCP', target: 'node.example.com' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(status.createService(staff, { ...svcInput, slug: 'all' })).rejects.toThrow();

    const audit = await testDb().securityAuditEvent.findFirst({ where: { guildId, action: 'status.service.create' } });
    expect(JSON.stringify(audit?.metadata)).not.toContain('panel-secret');
  });

  it('allowPrivate requires settings.manage in addition and is audited', async () => {
    const guildId = await freshGuild();
    const priv = { ...svcInput, slug: 'node', target: 'http://10.0.0.5:8080/health', allowPrivate: true };
    await expect(status.createService(ctxAs(guildId, ['status.manage']), priv)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const admin = ctxAs(guildId, ['status.manage', 'settings.manage']);
    const s = await status.createService(admin, priv);
    expect(s.allowPrivate).toBe(true);
    expect(await testDb().securityAuditEvent.count({ where: { guildId, result: 'SUCCESS', action: 'status.service.allow_private' } })).toBe(1);

    // Turning it off is fine with status.manage; turning it back on is not.
    const mgr = ctxAs(guildId, ['status.manage']);
    await expect(status.updateService(mgr, s.id, { allowPrivate: false })).rejects.toMatchObject({ code: 'VALIDATION' }); // private target no longer allowed
    const pub = await status.createService(mgr, { ...svcInput, slug: 'web', target: 'https://web.example.com' });
    await expect(status.updateService(mgr, pub.id, { allowPrivate: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('public status and uptime never include monitoring internals; uptime says "no data" honestly', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['status.manage', 'settings.manage']);
    const s = await status.createService(staff, { ...svcInput, allowPrivate: true, target: 'http://10.9.9.9:8443/x' });
    await status.createService(staff, { ...svcInput, slug: 'hidden', name: 'Hidden Internal', public: false, target: 'https://hidden.example.com' });

    const ps = await status.getPublicStatus(testDb(), guildId);
    expect(ps.services.map((x) => x.slug)).toEqual(['panel']);
    const json = JSON.stringify(ps);
    for (const f of ['10.9.9.9', 'target', 'allowPrivate', 'errorClass', 'Hidden Internal', '"port"']) expect(json).not.toContain(f);

    expect(await status.getUptime(testDb(), guildId, { days: 7 })).toEqual([
      { slug: 'panel', name: 'Game Panel', days: 7, totalChecks: 0, okChecks: 0, uptimePct: null, label: 'no data' },
    ]);

    const now = new Date();
    await testDb().healthCheck.createMany({
      data: [
        ...Array.from({ length: 3 }, (_, i) => ({ serviceId: s.id, ok: true, checkedAt: new Date(now.getTime() - (i + 1) * 60_000) })),
        { serviceId: s.id, ok: false, errorClass: 'TIMEOUT', checkedAt: new Date(now.getTime() - 120_000) },
        { serviceId: s.id, ok: false, errorClass: 'TIMEOUT', checkedAt: new Date(now.getTime() - 3 * 86_400_000) }, // outside 1d
      ],
    });
    const day = await status.getUptime(testDb(), guildId, { slug: 'panel', days: 1 }, now);
    expect(day[0]).toMatchObject({ totalChecks: 4, okChecks: 3, uptimePct: 75, label: '75.00%' });
    const week = await status.getUptime(testDb(), guildId, { slug: 'panel', days: 7 }, now);
    expect(week[0]).toMatchObject({ totalChecks: 5, okChecks: 3, label: '60.00%' });
    expect(JSON.stringify(week)).not.toContain('TIMEOUT');

    await expect(status.getUptime(testDb(), guildId, { slug: 'hidden' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(status.getUptime(testDb(), guildId, { days: 3 })).rejects.toThrow();
  });

  it('manual state is only for MANUAL services and needs staff permissions', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['status.manage']);
    const manual = await status.createService(staff, { name: 'Billing portal', slug: 'billing', kind: 'MANUAL', target: 'https://ignored.example.com' });
    expect(manual.target).toBeNull();
    const http = await status.createService(staff, svcInput);
    await expect(status.setManualState(ctxAs(guildId), manual.id, { state: 'OUTAGE' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(status.setManualState(staff, http.id, { state: 'OUTAGE' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const s = await status.setManualState(staff, manual.id, { state: 'OUTAGE' });
    expect(s.state).toBe('OUTAGE');
    expect(await testDb().scheduledJob.count({ where: { guildId, type: 'status.alert' } })).toBe(1);
  });
});

describe('status: incidents', () => {
  it('members cannot create or update incidents', async () => {
    const guildId = await freshGuild();
    await expect(status.createIncident(ctxAs(guildId), { title: 'x x x', description: 'y y y', severity: 'MINOR' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(status.createIncident(ctxAs(guildId, ['incidents.view']), { title: 'x x x', description: 'y y y', severity: 'MINOR' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const staff = ctxAs(guildId, ['incidents.manage']);
    const inc = await status.createIncident(staff, { title: 'Panel issues', description: 'Investigating.', severity: 'MINOR' });
    await expect(status.addIncidentUpdate(ctxAs(guildId), inc.id, { status: 'RESOLVED', message: 'done', resolutionSummary: 'done' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(status.listIncidents(ctxAs(guildId))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('creates INC refs, enforces transitions and resolution summaries, enqueues notifications and audits', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['incidents.manage', 'status.manage']);
    await status.createService(staff, svcInput);
    const inc = await status.createIncident(staff, {
      title: 'Login errors @everyone',
      description: 'Investigating login failures from 192.168.1.10',
      severity: 'MAJOR',
      serviceSlugs: ['panel'],
    });
    expect(inc.ref).toBe('INC-0001');
    expect(inc.title).not.toContain('@everyone');
    expect(inc.description).not.toContain('192.168.1.10');
    await expect(status.createIncident(staff, { title: 'Bad', description: 'Bad svc', severity: 'MINOR', serviceSlugs: ['nope'] })).rejects.toMatchObject({ code: 'VALIDATION' });

    const second = await status.createIncident(staff, { title: 'Other', description: 'Other thing', severity: 'MINOR' });
    expect(second.ref).toBe('INC-0002');

    // Skip forward straight to MONITORING
    const r1 = await status.addIncidentUpdate(staff, inc.id, { status: 'MONITORING', message: 'Fix deployed.' });
    expect(r1.incident.status).toBe('MONITORING');
    await expect(status.addIncidentUpdate(staff, inc.id, { status: 'RESOLVED', message: 'All good.' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const r2 = await status.addIncidentUpdate(staff, inc.id, { status: 'RESOLVED', message: 'All good.', resolutionSummary: 'Rolled back a bad release.' });
    expect(r2.incident).toMatchObject({ status: 'RESOLVED', resolutionSummary: 'Rolled back a bad release.' });
    expect(r2.incident.resolvedAt).toBeTruthy();
    await expect(status.addIncidentUpdate(staff, inc.id, { status: 'INVESTIGATING', message: 'Back again' })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const updates = await testDb().incidentUpdate.findMany({ where: { incidentId: inc.id } });
    expect(updates).toHaveLength(3);
    for (const u of updates) {
      expect(await testDb().scheduledJob.findUnique({ where: { dedupeKey: `status.incident.notify:${u.id}` } })).toBeTruthy();
    }
    expect(await testDb().securityAuditEvent.count({ where: { guildId, result: 'SUCCESS', action: { startsWith: 'status.incident.' } } })).toBe(4);

    // Public history: active vs resolved, paginated, customer fields only.
    const active = await status.listActiveIncidents(testDb(), guildId);
    expect(active.map((i) => i.ref)).toEqual(['INC-0002']);
    for (let n = 3; n <= 8; n++) {
      const x = await status.createIncident(staff, { title: `Incident ${n}`, description: 'Something', severity: 'MINOR' });
      await status.addIncidentUpdate(staff, x.id, { status: 'RESOLVED', message: 'Fixed now', resolutionSummary: 'fixed' });
    }
    const p1 = await status.getIncidentHistory(testDb(), guildId, { limit: 5 });
    expect(p1.items).toHaveLength(5);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await status.getIncidentHistory(testDb(), guildId, { limit: 5, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(2);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.ref)).size).toBe(7);
    expect(JSON.stringify(p1)).not.toContain('createdById');
  });
});

describe('status: maintenance windows', () => {
  it('validates, enqueues announce/start/end, reschedules and cancels; members are denied', async () => {
    const guildId = await freshGuild();
    const deps = testDeps();
    const staff = ctxAs(guildId, ['incidents.manage', 'status.manage'], { deps });
    await status.createService(staff, svcInput);
    const now = Date.now();
    const startsAt = new Date(now + 3_600_000);
    const endsAt = new Date(now + 7_200_000);

    await expect(status.createMaintenance(ctxAs(guildId), { title: 'Upgrade', description: 'Upgrade', startsAt, endsAt })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(status.createMaintenance(staff, { title: 'Upgrade', description: 'Upgrade', startsAt: endsAt, endsAt: startsAt })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(status.createMaintenance(staff, { title: 'Upgrade', description: 'Upgrade', startsAt, endsAt: startsAt })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(status.createMaintenance(staff, { title: 'Upgrade', description: 'Upgrade', startsAt, endsAt, serviceSlugs: ['ghost'] })).rejects.toMatchObject({ code: 'VALIDATION' });

    const w = await status.createMaintenance(staff, { title: 'Upgrade', description: 'Kernel upgrade', startsAt, endsAt, serviceSlugs: ['panel'] });
    const keys = status.maintenanceJobKeys(w.id);
    const jobs = await testDb().scheduledJob.findMany({ where: { dedupeKey: { in: [keys.announce, keys.start, keys.end] } } });
    expect(jobs).toHaveLength(3);
    expect(jobs.find((j) => j.dedupeKey === keys.start)!.runAt.getTime()).toBe(startsAt.getTime());
    expect(jobs.find((j) => j.dedupeKey === keys.end)!.runAt.getTime()).toBe(endsAt.getTime());

    const public1 = await status.getPublicStatus(testDb(), guildId);
    expect(public1.upcomingMaintenance.map((m) => m.title)).toEqual(['Upgrade']);

    const later = new Date(now + 10_800_000);
    const laterEnd = new Date(now + 14_400_000);
    await expect(status.updateMaintenance(ctxAs(guildId), w.id, { startsAt: later })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(status.updateMaintenance(staff, w.id, { startsAt: later })).rejects.toMatchObject({ code: 'VALIDATION' }); // would end before start
    await status.updateMaintenance(staff, w.id, { startsAt: later, endsAt: laterEnd });
    expect((await testDb().scheduledJob.findUniqueOrThrow({ where: { dedupeKey: keys.start } })).runAt.getTime()).toBe(later.getTime());
    expect((await testDb().scheduledJob.findUniqueOrThrow({ where: { dedupeKey: keys.end } })).runAt.getTime()).toBe(laterEnd.getTime());

    await expect(status.cancelMaintenance(ctxAs(guildId), w.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const c = await status.cancelMaintenance(staff, w.id);
    expect(c.status).toBe('CANCELLED');
    const after = await testDb().scheduledJob.findMany({ where: { dedupeKey: { in: [keys.announce, keys.start, keys.end] } } });
    expect(after.every((j) => j.status === 'CANCELLED')).toBe(true);
    expect((await status.getPublicStatus(testDb(), guildId)).upcomingMaintenance).toHaveLength(0);
  });
});

describe('status: subscriptions', () => {
  it('subscribes to all or a public service, updates in place, lists and removes own subscriptions', async () => {
    const guildId = await freshGuild();
    const deps = testDeps();
    const staff = ctxAs(guildId, ['status.manage'], { deps });
    await status.createService(staff, svcInput);
    await status.createService(staff, { ...svcInput, slug: 'hidden', public: false, target: 'https://h.example.com' });
    const userId = snowflake();
    const member = ctxAs(guildId, [], { deps, userId });

    const all = await status.subscribe(member, { service: 'all' });
    expect(all.serviceSlug).toBe('*');
    await status.subscribe(member, { service: 'panel', minSeverity: 'MAJOR', maintenance: false });
    const updated = await status.subscribe(member, { service: 'panel', minSeverity: 'CRITICAL' });
    expect(updated.minSeverity).toBe('CRITICAL');
    await expect(status.subscribe(member, { service: 'hidden' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(status.subscribe(member, { service: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const mine = await status.listMySubscriptions(member);
    expect(mine.map((s) => s.serviceSlug).sort()).toEqual(['*', 'panel']);
    // Another member sees only their own.
    expect(await status.listMySubscriptions(ctxAs(guildId, [], { deps }))).toEqual([]);

    expect(await status.unsubscribe(member, 'panel')).toBe(1);
    expect(await status.unsubscribe(member, 'everything')).toBe(1);
    expect(await status.listMySubscriptions(member)).toEqual([]);
  });

  it('is rate limited', async () => {
    const guildId = await freshGuild();
    const member = ctxAs(guildId);
    for (let i = 0; i < 10; i++) await status.subscribe(member, { service: 'all' });
    await expect(status.subscribe(member, { service: 'all' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
