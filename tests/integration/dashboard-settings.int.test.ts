import { afterAll, describe, expect, it } from 'vitest';
import { marketing } from '@gynx/services';
import { MemoryRateLimiter } from '@gynx/shared';
import { clearChannelCache } from '../../apps/dashboard/src/app/api/discord/channels/channels';
import { listChannelsRoute } from '../../apps/dashboard/src/app/api/discord/channels/handlers';
import { getSettingsRoute, updateSettingsRoute } from '../../apps/dashboard/src/app/api/settings/handlers';
import { REDIRECT_LIMIT, handleRedirect } from '../../apps/dashboard/src/app/r/[slug]/redirect';
import { executeApi, type ApiRuntime } from '../../apps/dashboard/src/server/api-core';
import { createSession } from '../../apps/dashboard/src/server/session-store';
import { ctxAs, fakeDiscord, freshGuild, snowflake, testDb, testDeps } from './helpers';

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

async function call(
  def: { opts: Parameters<typeof executeApi>[0]; handler: Parameters<typeof executeApi>[1] },
  guildId: string,
  opts: {
    method?: string;
    who?: { token: string; csrf: string };
    body?: unknown;
    csrf?: boolean;
    rt?: ApiRuntime;
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
  const req = new Request(`${ORIGIN}/api/settings`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const rt = opts.rt ?? { deps: testDeps({ dashboardUrl: ORIGIN }), guildId, dashboardOrigin: ORIGIN };
  const res = await executeApi(def.opts, def.handler, req, {}, rt);
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed JSON assertions in tests
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}

describe('dashboard settings API', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('401 / 403 / CSRF gates', async () => {
    const guildId = await freshGuild();
    expect((await call(getSettingsRoute, guildId)).status).toBe(401);
    const plain = await staff(guildId, ['status.manage']);
    expect((await call(getSettingsRoute, guildId, { who: plain })).status).toBe(403);
    expect(
      (await call(updateSettingsRoute, guildId, { method: 'PATCH', who: plain, body: { embedFooter: 'X' } }))
        .status,
    ).toBe(403);

    const admin = await staff(guildId, ['settings.manage']);
    const noCsrf = await call(updateSettingsRoute, guildId, {
      method: 'PATCH',
      who: admin,
      body: { embedFooter: 'X' },
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF');
  });

  it('updates only the sent fields and audits before/after', async () => {
    const guildId = await freshGuild();
    const admin = await staff(guildId, ['settings.manage']);
    const before = await call(getSettingsRoute, guildId, { who: admin });
    expect(before.status).toBe(200);

    const logChannel = snowflake();
    const res = await call(updateSettingsRoute, guildId, {
      method: 'PATCH',
      who: admin,
      body: {
        timezone: 'Europe/London',
        channels: { log: logChannel },
        status: { failureThreshold: 5 },
        supportUrl: 'https://support.gynx.gg',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      timezone: 'Europe/London',
      supportUrl: 'https://support.gynx.gg',
      channels: { log: logChannel },
      status: { failureThreshold: 5 },
    });
    expect(res.body.status.recoveryThreshold).toBe(before.body.status.recoveryThreshold);
    expect(res.body.embedFooter).toBe(before.body.embedFooter);

    const event = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'settings.update', actorId: admin.userId },
    });
    expect(event?.result).toBe('SUCCESS');
    expect(event?.source).toBe('dashboard');
    expect(JSON.stringify(event?.metadata)).toContain('statusFailureThreshold');
  });

  it('returns field-level validation issues and safe cross-field errors', async () => {
    const guildId = await freshGuild();
    const admin = await staff(guildId, ['settings.manage']);
    const bad = await call(updateSettingsRoute, guildId, {
      method: 'PATCH',
      who: admin,
      body: { retention: { auditDays: 5 }, supportUrl: 'http://insecure.example' },
    });
    expect(bad.status).toBe(400);
    const paths = (bad.body.error.issues as Array<{ path: string }>).map((i) => i.path).sort();
    expect(paths).toEqual(['retention.auditDays', 'supportUrl']);

    const same = snowflake();
    const cross = await call(updateSettingsRoute, guildId, {
      method: 'PATCH',
      who: admin,
      body: { channels: { security: same, announcement: same } },
    });
    expect(cross.status).toBe(400);
    expect(cross.body.error.message).toMatch(/staff-only/);
  });
});

describe('dashboard /api/discord/channels', () => {
  it('lists text/announcement/category channels for any staff member, sorted', async () => {
    clearChannelCache();
    const guildId = await freshGuild();
    const who = await staff(guildId, []);
    const discord = fakeDiscord({
      listChannels: async () => [
        { id: '3', name: 'voice', type: 2, parentId: null },
        { id: '2', name: 'news', type: 5, parentId: '9' },
        { id: '9', name: 'Info', type: 4, parentId: null },
        { id: '1', name: 'general', type: 0, parentId: null },
      ],
    });
    const rt: ApiRuntime = {
      deps: testDeps({ dashboardUrl: ORIGIN, discord }),
      guildId,
      dashboardOrigin: ORIGIN,
    };
    const res = await call(listChannelsRoute, guildId, { who, rt });
    expect(res.status).toBe(200);
    expect(res.body.channels).toEqual([
      { id: '1', name: 'general', type: 'text', parentId: null },
      { id: '9', name: 'Info', type: 'category', parentId: null },
      { id: '2', name: 'news', type: 'announcement', parentId: '9' },
    ]);
    expect((await call(listChannelsRoute, guildId, { rt })).status).toBe(401);
  });
});

describe('tracked-link redirect /r/:slug', () => {
  it('302s active links and counts the click, 404s inactive/unknown, rate limits per client', async () => {
    const guildId = await freshGuild();
    const staffCtx = ctxAs(guildId, ['announcements.create']);
    const link = await marketing.createTrackedLink(staffCtx, { targetUrl: 'https://gynx.gg/launch' });
    const deps = { db: testDb(), rateLimiter: new MemoryRateLimiter() };
    const req = (ip = '203.0.113.7') =>
      new Request(`${ORIGIN}/r/${link.slug}`, { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });

    const ok = await handleRedirect(req(), link.slug, deps);
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('https://gynx.gg/launch');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await testDb().trackedLink.findUniqueOrThrow({ where: { id: link.id } })).clicks).toBe(1);

    expect((await handleRedirect(req(), 'bad slug!', deps)).status).toBe(404);
    expect((await handleRedirect(req(), 'zzzzzzzz', deps)).status).toBe(404);

    await marketing.setTrackedLinkActive(staffCtx, link.id, false);
    const inactive = await handleRedirect(req(), link.slug, deps);
    expect(inactive.status).toBe(404);
    expect(inactive.headers.get('content-type')).toContain('text/html');
    expect((await testDb().trackedLink.findUniqueOrThrow({ where: { id: link.id } })).clicks).toBe(1);

    // Click inflation guard: one client is limited, another is not.
    await marketing.setTrackedLinkActive(staffCtx, link.id, true);
    const limiter = { db: testDb(), rateLimiter: new MemoryRateLimiter() };
    for (let i = 0; i < REDIRECT_LIMIT.limit; i++)
      await handleRedirect(req('198.51.100.1'), link.slug, limiter);
    const limited = await handleRedirect(req('198.51.100.1'), link.slug, limiter);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await handleRedirect(req('198.51.100.2'), link.slug, limiter)).status).toBe(302);
    expect((await testDb().trackedLink.findUniqueOrThrow({ where: { id: link.id } })).clicks).toBe(
      1 + REDIRECT_LIMIT.limit + 1,
    );
  });
});
