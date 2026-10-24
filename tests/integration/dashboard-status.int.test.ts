import { afterAll, describe, expect, it } from 'vitest';
import {
  addIncidentUpdateRoute,
  cancelMaintenanceRoute,
  createIncidentRoute,
  createMaintenanceRoute,
  createServiceRoute,
  deleteServiceRoute,
  listServicesRoute,
  setServiceStateRoute,
  updateServiceRoute,
} from '../../apps/dashboard/src/app/api/status/handlers';
import { executeApi, type ApiRuntime } from '../../apps/dashboard/src/server/api-core';
import { createSession } from '../../apps/dashboard/src/server/session-store';
import { freshGuild, snowflake, testDb, testDeps } from './helpers';

const ORIGIN = 'https://dash.test';

async function staff(guildId: string, permissions: string[]) {
  const userId = snowflake();
  const { token, session } = await createSession(
    testDb(),
    {
      userId,
      guildId,
      username: 'staff',
      avatar: null,
      roleIds: [],
      permissions: ['dashboard.access', ...permissions] as never,
      ttlHours: 1,
      userAgent: 'vitest',
    },
    new Date(),
  );
  return { userId, token, csrf: session.csrfToken };
}

const runtime = (guildId: string): ApiRuntime => ({
  deps: testDeps({ dashboardUrl: ORIGIN }),
  guildId,
  dashboardOrigin: ORIGIN,
});

async function call(
  def: { opts: Parameters<typeof executeApi>[0]; handler: Parameters<typeof executeApi>[1] },
  guildId: string,
  opts: {
    method?: string;
    path?: string;
    who?: { token: string; csrf: string };
    body?: unknown;
    params?: Record<string, string>;
    csrf?: boolean;
  } = {},
) {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts.who) headers.cookie = `gynx_session=${opts.who.token}`;
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    if (opts.csrf !== false && opts.who) headers['x-csrf-token'] = opts.who.csrf;
  }
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`${ORIGIN}${opts.path ?? '/api/status/x'}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await executeApi(def.opts, def.handler, req, opts.params ?? {}, runtime(guildId));
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed JSON assertions in tests
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}

const svc = {
  name: 'Game Panel',
  slug: 'panel',
  region: 'EU',
  kind: 'HTTP',
  target: 'https://panel-internal.example.com/health',
};

describe('dashboard status API', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('401 without a session, 403 without the permission, 403 without CSRF', async () => {
    const guildId = await freshGuild();
    expect((await call(listServicesRoute, guildId)).status).toBe(401);

    const viewer = await staff(guildId, ['incidents.view']);
    const denied = await call(createServiceRoute, guildId, { method: 'POST', who: viewer, body: svc });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const manager = await staff(guildId, ['status.manage']);
    const noCsrf = await call(createServiceRoute, guildId, {
      method: 'POST',
      who: manager,
      body: svc,
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF');
    expect(await testDb().monitoredService.count({ where: { guildId } })).toBe(0);
  });

  it('creates a service; only status.manage sees the internal target', async () => {
    const guildId = await freshGuild();
    const manager = await staff(guildId, ['status.manage']);
    const created = await call(createServiceRoute, guildId, { method: 'POST', who: manager, body: svc });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      slug: 'panel',
      target: 'https://panel-internal.example.com/health',
      targetHidden: false,
    });

    const viewer = await staff(guildId, ['incidents.view']);
    const asViewer = await call(listServicesRoute, guildId, { who: viewer });
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.services).toHaveLength(1);
    expect(asViewer.body.services[0]).toMatchObject({
      slug: 'panel',
      target: null,
      port: null,
      targetHidden: true,
    });
    expect(JSON.stringify(asViewer.body)).not.toContain('panel-internal');

    const asManager = await call(listServicesRoute, guildId, { who: manager });
    expect(asManager.body.services[0].target).toBe('https://panel-internal.example.com/health');

    // A member with dashboard access only is refused by the service's any-of check.
    const plain = await staff(guildId, []);
    expect((await call(listServicesRoute, guildId, { who: plain })).status).toBe(403);
  });

  it('allowPrivate requires settings.manage on top of status.manage', async () => {
    const guildId = await freshGuild();
    const priv = { ...svc, slug: 'node', target: 'http://10.0.0.5:8080/health', allowPrivate: true };
    const manager = await staff(guildId, ['status.manage']);
    const denied = await call(createServiceRoute, guildId, { method: 'POST', who: manager, body: priv });
    expect(denied.status).toBe(403);
    expect(await testDb().monitoredService.count({ where: { guildId } })).toBe(0);

    const admin = await staff(guildId, ['status.manage', 'settings.manage']);
    const ok = await call(createServiceRoute, guildId, { method: 'POST', who: admin, body: priv });
    expect(ok.status).toBe(200);
    expect(ok.body.allowPrivate).toBe(true);
    expect(
      await testDb().securityAuditEvent.count({
        where: { guildId, action: 'status.service.allow_private', actorId: admin.userId },
      }),
    ).toBe(1);

    // Turning it on later via update is also gated.
    const plainSvc = await call(createServiceRoute, guildId, {
      method: 'POST',
      who: manager,
      body: { ...svc, slug: 'web' },
    });
    const upd = await call(updateServiceRoute, guildId, {
      method: 'PATCH',
      who: manager,
      body: { allowPrivate: true },
      params: { id: plainSvc.body.id },
    });
    expect(upd.status).toBe(403);
  });

  it('validates input, sets MANUAL state and deletes', async () => {
    const guildId = await freshGuild();
    const manager = await staff(guildId, ['status.manage']);
    const bad = await call(createServiceRoute, guildId, {
      method: 'POST',
      who: manager,
      body: { ...svc, slug: 'Not A Slug!' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues[0].path).toBe('slug');

    const manual = await call(createServiceRoute, guildId, {
      method: 'POST',
      who: manager,
      body: { name: 'Billing', slug: 'billing', kind: 'MANUAL' },
    });
    expect(manual.status).toBe(200);
    const incidentsOnly = await staff(guildId, ['incidents.manage']);
    const set = await call(setServiceStateRoute, guildId, {
      method: 'POST',
      who: incidentsOnly,
      body: { state: 'OUTAGE' },
      params: { id: manual.body.id },
    });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ state: 'OUTAGE', targetHidden: true });

    const del = await call(deleteServiceRoute, guildId, {
      method: 'DELETE',
      who: manager,
      params: { id: manual.body.id },
    });
    expect(del.status).toBe(200);
    expect(await testDb().monitoredService.count({ where: { guildId } })).toBe(0);
  });

  it('creates an incident and requires a resolution summary to resolve it', async () => {
    const guildId = await freshGuild();
    const manager = await staff(guildId, ['incidents.manage']);
    const inc = await call(createIncidentRoute, guildId, {
      method: 'POST',
      who: manager,
      body: { title: 'Login failures', description: 'Members cannot log in.', severity: 'MAJOR' },
    });
    expect(inc.status).toBe(200);
    expect(inc.body.ref).toMatch(/^INC-/);

    const noSummary = await call(addIncidentUpdateRoute, guildId, {
      method: 'POST',
      who: manager,
      body: { status: 'RESOLVED', message: 'Fixed.' },
      params: { id: inc.body.id },
    });
    expect(noSummary.status).toBe(400);

    const resolved = await call(addIncidentUpdateRoute, guildId, {
      method: 'POST',
      who: manager,
      body: { status: 'RESOLVED', message: 'Fixed.', resolutionSummary: 'A bad deploy was rolled back.' },
      params: { id: inc.body.id },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.incident.status).toBe('RESOLVED');
    expect(
      await testDb().securityAuditEvent.count({
        where: { guildId, action: 'status.incident.update', actorId: manager.userId },
      }),
    ).toBe(1);
  });

  it('converts maintenance times from the guild time zone and cancels', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { timezone: 'Europe/London' } });
    const manager = await staff(guildId, ['incidents.manage']);
    const year = new Date().getUTCFullYear() + 1;
    const created = await call(createMaintenanceRoute, guildId, {
      method: 'POST',
      who: manager,
      body: {
        title: 'Database upgrade',
        description: 'Brief downtime.',
        startsLocal: `${year}-07-01T09:00`,
        endsLocal: `${year}-07-01T10:30`,
      },
    });
    expect(created.status).toBe(200);
    expect(new Date(created.body.startsAt).toISOString()).toBe(`${year}-07-01T08:00:00.000Z`);
    expect(new Date(created.body.endsAt).toISOString()).toBe(`${year}-07-01T09:30:00.000Z`);

    const viewer = await staff(guildId, ['incidents.view']);
    expect(
      (
        await call(cancelMaintenanceRoute, guildId, {
          method: 'POST',
          who: viewer,
          params: { id: created.body.id },
        })
      ).status,
    ).toBe(403);
    const cancelled = await call(cancelMaintenanceRoute, guildId, {
      method: 'POST',
      who: manager,
      params: { id: created.body.id },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
  });
});
