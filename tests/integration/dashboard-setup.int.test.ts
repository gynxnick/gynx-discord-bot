import { afterAll, describe, expect, it } from 'vitest';
import {
  cancelRoute,
  confirmRoute,
  getConfigRoute,
  getOperationRoute,
  listOperationsRoute,
  overviewRoute,
  previewRoute,
  rollbackPreviewRoute,
  updateConfigRoute,
} from '../../apps/dashboard/src/app/api/setup/handlers';
import { executeApi, type ApiRuntime } from '../../apps/dashboard/src/server/api-core';
import { createSession } from '../../apps/dashboard/src/server/session-store';
import { freshGuild, snowflake, testDb, testDeps } from './helpers';

/**
 * Gatekeeping of the setup wizard API (auth, permission, CSRF, validation).
 * Engine behaviour is covered by the engine's own tests; none of these
 * requests reach a service function.
 */

const ORIGIN = 'https://dash.test';

type Def = { opts: Parameters<typeof executeApi>[0]; handler: Parameters<typeof executeApi>[1] };

const ROUTES: Array<{
  name: string;
  def: Def;
  method: string;
  path: string;
  body?: unknown;
  params?: Record<string, string>;
}> = [
  { name: 'overview', def: overviewRoute, method: 'GET', path: '/api/setup/overview' },
  { name: 'config get', def: getConfigRoute, method: 'GET', path: '/api/setup/config' },
  {
    name: 'config patch',
    def: updateConfigRoute,
    method: 'PATCH',
    path: '/api/setup/config',
    body: { showStaffNames: false },
  },
  { name: 'preview', def: previewRoute, method: 'POST', path: '/api/setup/preview', body: { type: 'START' } },
  {
    name: 'rollback preview',
    def: rollbackPreviewRoute,
    method: 'POST',
    path: '/api/setup/rollback/preview',
    body: {},
  },
  { name: 'operations list', def: listOperationsRoute, method: 'GET', path: '/api/setup/operations' },
  {
    name: 'operation get',
    def: getOperationRoute,
    method: 'GET',
    path: '/api/setup/operations/op1',
    params: { id: 'op1' },
  },
  {
    name: 'confirm',
    def: confirmRoute,
    method: 'POST',
    path: '/api/setup/operations/op1/confirm',
    body: { acceptDisruptive: false },
    params: { id: 'op1' },
  },
  {
    name: 'cancel',
    def: cancelRoute,
    method: 'POST',
    path: '/api/setup/operations/op1/cancel',
    params: { id: 'op1' },
  },
];

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

async function call(
  route: (typeof ROUTES)[number],
  guildId: string,
  opts: { who?: { token: string; csrf: string }; csrf?: boolean; body?: unknown; rt?: ApiRuntime } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.who) headers.cookie = `gynx_session=${opts.who.token}`;
  const body = opts.body ?? route.body;
  if (route.method !== 'GET') {
    headers.origin = ORIGIN;
    if (opts.csrf !== false && opts.who) headers['x-csrf-token'] = opts.who.csrf;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`${ORIGIN}${route.path}`, {
    method: route.method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const rt = opts.rt ?? { deps: testDeps({ dashboardUrl: ORIGIN }), guildId, dashboardOrigin: ORIGIN };
  const res = await executeApi(route.def.opts, route.def.handler, req, route.params ?? {}, rt);
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed JSON assertions in tests
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}

const route = (name: string) => ROUTES.find((r) => r.name === name)!;

describe('dashboard setup API', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('every route requires a session (401)', async () => {
    const guildId = await freshGuild();
    for (const r of ROUTES) {
      const res = await call(r, guildId);
      expect(res.status, r.name).toBe(401);
    }
  });

  it('every route requires setup.manage (403) and audits the denial', async () => {
    const guildId = await freshGuild();
    const plain = await staff(guildId, ['settings.manage']);
    for (const r of ROUTES) {
      const res = await call(r, guildId, { who: plain });
      expect(res.status, r.name).toBe(403);
      expect(res.body.error.code, r.name).toBe('FORBIDDEN');
    }
    const denials = await testDb().securityAuditEvent.findMany({
      where: { guildId, actorId: plain.userId, action: 'dashboard.permission.denied', result: 'DENIED' },
    });
    expect(denials).toHaveLength(ROUTES.length);
    const paths = denials.map((d) => (d.metadata as { path?: string }).path).sort();
    expect(paths).toEqual(ROUTES.map((r) => r.path).sort());
    for (const d of denials) expect((d.metadata as { required?: string }).required).toBe('setup.manage');
  });

  it('mutations without the CSRF token are rejected (403 CSRF)', async () => {
    const guildId = await freshGuild();
    const admin = await staff(guildId, ['setup.manage']);
    for (const r of ROUTES.filter((x) => x.method !== 'GET')) {
      const res = await call(r, guildId, { who: admin, csrf: false });
      expect(res.status, r.name).toBe(403);
      expect(res.body.error.code, r.name).toBe('CSRF');
    }
    const rejected = await testDb().securityAuditEvent.count({
      where: { guildId, actorId: admin.userId, action: 'dashboard.csrf.rejected', result: 'DENIED' },
    });
    expect(rejected).toBe(ROUTES.filter((x) => x.method !== 'GET').length);
  });

  it('config PATCH returns field-level validation issues (400)', async () => {
    const guildId = await freshGuild();
    const admin = await staff(guildId, ['setup.manage']);
    const bad = await call(route('config patch'), guildId, {
      who: admin,
      body: {
        roles: { founder: { color: 'red' } },
        slowmode: { general: 99_999 },
        restrictedAccess: { 'mod-logs': [] },
      },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
    const paths = (bad.body.error.issues as Array<{ path: string }>).map((i) => i.path).sort();
    expect(paths).toEqual(['restrictedAccess.mod-logs', 'roles.founder.color', 'slowmode.general']);

    const unknownKey = await call(route('config patch'), guildId, { who: admin, body: { surprise: true } });
    expect(unknownKey.status).toBe(400);
    const unknownRole = await call(route('config patch'), guildId, {
      who: admin,
      body: { roles: { overlord: { name: 'X' } } },
    });
    expect(unknownRole.status).toBe(400);
  });

  it('preview and confirm bodies are validated (400)', async () => {
    const guildId = await freshGuild();
    const admin = await staff(guildId, ['setup.manage']);
    const badType = await call(route('preview'), guildId, { who: admin, body: { type: 'DESTROY' } });
    expect(badType.status).toBe(400);
    expect(badType.body.error.issues[0].path).toBe('type');
    const badSel = await call(route('preview'), guildId, {
      who: admin,
      body: { type: 'START', selection: ['category:nope'] },
    });
    expect(badSel.status).toBe(400);
    const badConfirm = await call(route('confirm'), guildId, {
      who: admin,
      body: { acceptDisruptive: 'yes' },
    });
    expect(badConfirm.status).toBe(400);
    expect(badConfirm.body.error.issues[0].path).toBe('acceptDisruptive');
  });

  it('previews (and rollback previews) share a 10/min limit', async () => {
    const guildId = await freshGuild();
    const admin = await staff(guildId, ['setup.manage']);
    const rt = { deps: testDeps({ dashboardUrl: ORIGIN }), guildId, dashboardOrigin: ORIGIN };
    // Invalid bodies: counted by the limiter but never reach the engine.
    for (let i = 0; i < 10; i++) {
      const r = await call(route(i % 2 ? 'preview' : 'rollback preview'), guildId, {
        who: admin,
        rt,
        body: { type: 'NOPE', operationId: '!' },
      });
      expect(r.status).toBe(400);
    }
    const limited = await call(route('preview'), guildId, { who: admin, rt, body: { type: 'NOPE' } });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});
