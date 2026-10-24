import { afterAll, describe, expect, it } from 'vitest';
import { analytics } from '@gynx/services';
import { handlers } from '../../apps/dashboard/src/app/api/analytics/_handlers';
import { executeApi, type ApiRuntime } from '../../apps/dashboard/src/server/api-core';
import { createSession } from '../../apps/dashboard/src/server/session-store';
import { ctxAs, freshGuild, snowflake, testDb, testDeps } from './helpers';

const ORIGIN = 'https://dash.test';

const runtime = (guildId: string): ApiRuntime => ({
  deps: testDeps({ dashboardUrl: ORIGIN }),
  guildId,
  dashboardOrigin: ORIGIN,
});

async function newSession(guildId: string, permissions: string[], userId = snowflake()) {
  const { token, session } = await createSession(
    testDb(),
    {
      userId,
      guildId,
      username: 'staff',
      avatar: null,
      roleIds: [],
      permissions: ['dashboard.access', ...permissions] as never,
      ttlHours: 12,
      userAgent: 'vitest',
    },
    new Date(),
  );
  return { token, csrf: session.csrfToken, userId };
}

const get = (path: string, token?: string) =>
  new Request(`${ORIGIN}${path}`, { headers: token ? { cookie: `gynx_session=${token}` } : {} });
const send = (method: string, path: string, token: string, csrf: string | null, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      cookie: `gynx_session=${token}`,
      origin: ORIGIN,
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

type Spec = { opts: Parameters<typeof executeApi>[0]; handler: Parameters<typeof executeApi>[1] };
const run = (h: Spec, req: Request, params: Record<string, string>, rt: ApiRuntime) =>
  executeApi(h.opts, h.handler, req, params, rt);

async function seedReport(guildId: string) {
  const now = new Date();
  const admin = ctxAs(guildId, ['settings.manage'], { deps: testDeps({ now: () => now }) });
  const def = await analytics.createReportDefinition(admin, {
    name: 'Weekly',
    day: 'MONDAY',
    time: '09:00',
    timezone: 'UTC',
  });
  const { report } = await analytics.generateReport(
    testDb(),
    def,
    analytics.reportPeriodFor(now, 7, 'UTC'),
    now,
  );
  return report;
}

const validDefinition = {
  name: 'Monthly board pack',
  enabled: true,
  day: 'FRIDAY',
  time: '17:30',
  timezone: 'Europe/London',
  periodDays: 28,
  channelId: null,
};

describe('dashboard analytics API', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const guildId = await freshGuild();
    const res = await run(handlers.overview as Spec, get('/api/analytics/overview'), {}, runtime(guildId));
    expect(res.status).toBe(401);
  });

  it('forbids a member without analytics.view (403) and audits the denial', async () => {
    const guildId = await freshGuild();
    const { token, userId } = await newSession(guildId, []);
    const res = await run(
      handlers.overview as Spec,
      get('/api/analytics/overview', token),
      {},
      runtime(guildId),
    );
    expect(res.status).toBe(403);
    const ev = await testDb().securityAuditEvent.findFirst({
      where: { guildId, actorId: userId, action: 'dashboard.permission.denied' },
    });
    expect(ev?.metadata).toMatchObject({ required: 'analytics.view' });
  });

  it('lets an analyst view the overview, including unavailable metrics and custom ranges', async () => {
    const guildId = await freshGuild();
    const { token } = await newSession(guildId, ['analytics.view', 'analytics.export', 'referrals.view']);
    const rt = runtime(guildId);
    const res = await run(handlers.overview as Spec, get('/api/analytics/overview?range=30d', token), {}, rt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as analytics.ReportData;
    expect(body.version).toBe(1);
    expect(body.marketing.giveawayEntries).toEqual({
      available: false,
      reason: 'no giveaways have been created yet',
    });
    expect(new Date(body.period.end).getTime() - new Date(body.period.start).getTime()).toBe(30 * 86_400_000);

    const custom = await run(
      handlers.overview as Spec,
      get('/api/analytics/overview?range=custom&start=2026-01-01&end=2026-01-07', token),
      {},
      rt,
    );
    expect(custom.status).toBe(200);
    expect(((await custom.json()) as analytics.ReportData).period).toEqual({
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-08T00:00:00.000Z',
    });

    const reversed = await run(
      handlers.overview as Spec,
      get('/api/analytics/overview?range=custom&start=2026-01-07&end=2026-01-01', token),
      {},
      rt,
    );
    expect(reversed.status).toBe(400);

    const staff = await run(handlers.staff as Spec, get('/api/analytics/staff', token), {}, rt);
    expect(staff.status).toBe(200);
    expect(((await staff.json()) as { rows: unknown[] }).rows).toEqual([]);
  });

  it('requires analytics.export to export, returns an attachment and writes an audit event', async () => {
    const guildId = await freshGuild();
    const report = await seedReport(guildId);
    const rt = runtime(guildId);

    const viewer = await newSession(guildId, ['analytics.view']);
    const denied = await run(
      handlers.exportReport as Spec,
      get(`/api/analytics/reports/${report.id}/export?format=csv`, viewer.token),
      { id: report.id },
      rt,
    );
    expect(denied.status).toBe(403);

    const analyst = await newSession(guildId, ['analytics.view', 'analytics.export']);
    const csv = await run(
      handlers.exportReport as Spec,
      get(`/api/analytics/reports/${report.id}/export?format=csv`, analyst.token),
      { id: report.id },
      rt,
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('content-disposition')).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.csv"/);
    expect(csv.headers.get('x-content-type-options')).toBe('nosniff');
    expect(csv.headers.get('cache-control')).toBe('no-store');
    expect((await csv.text()).split('\r\n')[0]).toBe(
      'section,metric,label,available,value,previous,delta,delta_pct,note',
    );

    const md = await run(
      handlers.exportReport as Spec,
      get(`/api/analytics/reports/${report.id}/export?format=markdown`, analyst.token),
      { id: report.id },
      rt,
    );
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(md.headers.get('content-disposition')).toMatch(/\.md"/);

    const json = await run(
      handlers.exportReport as Spec,
      get(`/api/analytics/reports/${report.id}/export?format=json`, analyst.token),
      { id: report.id },
      rt,
    );
    expect(json.headers.get('content-type')).toBe('application/json');
    expect(((await json.json()) as { version: number }).version).toBe(1);

    const bad = await run(
      handlers.exportReport as Spec,
      get(`/api/analytics/reports/${report.id}/export?format=html`, analyst.token),
      { id: report.id },
      rt,
    );
    expect(bad.status).toBe(400);

    const audits = await testDb().securityAuditEvent.findMany({
      where: { guildId, action: 'analytics.export', actorId: analyst.userId, targetId: report.id },
    });
    expect(audits.map((a) => (a.metadata as { format: string }).format).sort()).toEqual([
      'csv',
      'json',
      'markdown',
    ]);
    expect(audits.every((a) => a.result === 'SUCCESS' && a.source === 'dashboard')).toBe(true);
  });

  it('requires settings.manage to create a schedule and CSRF for every mutation', async () => {
    const guildId = await freshGuild();
    const rt = runtime(guildId);

    const analyst = await newSession(guildId, ['analytics.view', 'analytics.export']);
    const forbidden = await run(
      handlers.createDefinition as Spec,
      send('POST', '/api/analytics/definitions', analyst.token, analyst.csrf, validDefinition),
      {},
      rt,
    );
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    const admin = await newSession(guildId, ['analytics.view', 'settings.manage']);
    const noCsrf = await run(
      handlers.createDefinition as Spec,
      send('POST', '/api/analytics/definitions', admin.token, null, validDefinition),
      {},
      rt,
    );
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as { error: { code: string } }).error.code).toBe('CSRF');
    expect(await testDb().reportDefinition.count({ where: { guildId } })).toBe(0);

    const invalid = await run(
      handlers.createDefinition as Spec,
      send('POST', '/api/analytics/definitions', admin.token, admin.csrf, {
        ...validDefinition,
        periodDays: 40,
      }),
      {},
      rt,
    );
    expect(invalid.status).toBe(400);

    const created = await run(
      handlers.createDefinition as Spec,
      send('POST', '/api/analytics/definitions', admin.token, admin.csrf, validDefinition),
      {},
      rt,
    );
    expect(created.status).toBe(200);
    const def = (
      (await created.json()) as { definition: { id: string; nextRunAt: string; timezone: string } }
    ).definition;
    expect(def.timezone).toBe('Europe/London');
    expect(new Date(def.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(
      await testDb().securityAuditEvent.count({
        where: { guildId, action: 'analytics.report-definition.create', targetId: def.id },
      }),
    ).toBe(1);

    const paused = await run(
      handlers.updateDefinition as Spec,
      send('PATCH', `/api/analytics/definitions/${def.id}`, admin.token, admin.csrf, { enabled: false }),
      { id: def.id },
      rt,
    );
    expect(paused.status).toBe(200);
    const row = await testDb().reportDefinition.findUniqueOrThrow({ where: { id: def.id } });
    expect(row).toMatchObject({ enabled: false, nextRunAt: null, periodDays: 28 });

    const delNoCsrf = await run(
      handlers.deleteDefinition as Spec,
      send('DELETE', `/api/analytics/definitions/${def.id}`, admin.token, null),
      { id: def.id },
      rt,
    );
    expect(delNoCsrf.status).toBe(403);
    const del = await run(
      handlers.deleteDefinition as Spec,
      send('DELETE', `/api/analytics/definitions/${def.id}`, admin.token, admin.csrf),
      { id: def.id },
      rt,
    );
    expect(del.status).toBe(200);
    expect(await testDb().reportDefinition.count({ where: { guildId } })).toBe(0);
  });

  it('re-queues delivery of an undelivered report (settings.manage + CSRF)', async () => {
    const guildId = await freshGuild();
    const report = await seedReport(guildId);
    const rt = runtime(guildId);
    const admin = await newSession(guildId, ['analytics.view', 'settings.manage']);

    const noCsrf = await run(
      handlers.retryDelivery as Spec,
      send('POST', `/api/analytics/reports/${report.id}/retry`, admin.token, null),
      { id: report.id },
      rt,
    );
    expect(noCsrf.status).toBe(403);

    const ok = await run(
      handlers.retryDelivery as Spec,
      send('POST', `/api/analytics/reports/${report.id}/retry`, admin.token, admin.csrf),
      { id: report.id },
      rt,
    );
    expect(ok.status).toBe(200);
    const job = await testDb().scheduledJob.findUnique({
      where: { dedupeKey: analytics.deliverDedupeKey(report.id) },
    });
    expect(job?.status).toBe('PENDING');

    const list = await run(handlers.listReports as Spec, get('/api/analytics/reports', admin.token), {}, rt);
    expect(list.status).toBe(200);
    const items = ((await list.json()) as { items: Array<{ id: string; markdown?: string }> }).items;
    expect(items.map((i) => i.id)).toEqual([report.id]);
    expect(items[0]).not.toHaveProperty('markdown');
  });
});
