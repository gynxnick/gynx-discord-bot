import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { executeApi, type ApiRuntime } from '../../apps/dashboard/src/server/api-core';
import { retryJob } from '../../apps/dashboard/src/server/queries/jobs';
import {
  PERMS_MAX_STALE_MS,
  authorizeMember,
  createSession,
  hashSessionToken,
  loadSession,
  revokeSession,
  type SessionStoreDeps,
} from '../../apps/dashboard/src/server/session-store';
import { grantInputSchema } from '@gynx/services';
import { fakeDiscord, freshGuild, silentLog, snowflake, testDb, testDeps } from './helpers';

const ORIGIN = 'https://dash.test';
const MIN = 60_000;

function storeDeps(now: Date, discord = fakeDiscord()): SessionStoreDeps {
  return { db: testDb(), discord, log: silentLog, now: () => now };
}

async function grant(guildId: string, subjectType: 'ROLE' | 'USER', subjectId: string, permission: string) {
  await testDb().staffPermission.create({
    data: { guildId, subjectType, subjectId, permission, createdById: 'system' },
  });
}

async function newSession(
  guildId: string,
  opts: { userId?: string; roleIds?: string[]; permissions?: string[]; now?: Date; ttlHours?: number } = {},
) {
  return createSession(
    testDb(),
    {
      userId: opts.userId ?? snowflake(),
      guildId,
      username: 'staff-member',
      avatar: null,
      roleIds: opts.roleIds ?? [],
      permissions: (opts.permissions ?? ['dashboard.access']) as never,
      ttlHours: opts.ttlHours ?? 12,
      userAgent: 'vitest',
    },
    opts.now ?? new Date(),
  );
}

describe('dashboard sessions', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('stores only the token hash and supports lookup → expiry → revocation', async () => {
    const guildId = await freshGuild();
    const t0 = new Date();
    const { token, session } = await newSession(guildId, { now: t0, ttlHours: 1 });

    const row = await testDb().dashboardSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.tokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.csrfToken).not.toBe(token);
    expect(row.expiresAt.getTime() - t0.getTime()).toBe(3_600_000);

    const ok = await loadSession(storeDeps(new Date(t0.getTime() + MIN)), guildId, token);
    expect(ok.ok).toBe(true);
    expect(ok.ok && [...ok.session.permissions]).toEqual(['dashboard.access']);

    expect(await loadSession(storeDeps(t0), guildId, 'x'.repeat(43))).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await loadSession(storeDeps(t0), guildId, undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(await loadSession(storeDeps(t0), await freshGuild(), token)).toEqual({
      ok: false,
      reason: 'wrong_guild',
    });

    const expired = await loadSession(storeDeps(new Date(t0.getTime() + 3_600_000 + 1)), guildId, token);
    expect(expired).toEqual({ ok: false, reason: 'expired' });

    await revokeSession(testDb(), session.id, new Date());
    expect(await loadSession(storeDeps(new Date(t0.getTime() + MIN)), guildId, token)).toEqual({
      ok: false,
      reason: 'revoked',
    });
  });

  it('re-resolves permissions after 5 minutes and revokes when dashboard.access is lost', async () => {
    const guildId = await freshGuild();
    const roleId = snowflake();
    await grant(guildId, 'ROLE', roleId, 'MODERATOR');
    const userId = snowflake();
    const t0 = new Date();
    const { token, session } = await newSession(guildId, {
      userId,
      roleIds: [roleId],
      permissions: ['dashboard.access', 'moderation.execute'],
      now: t0,
    });

    // Still has the role → refreshed with the preset's full permission set.
    const withRole = fakeDiscord({
      getMember: async (_g, id) => ({
        userId: id,
        roles: [roleId],
        joinedAt: null,
        username: 'Renamed',
        avatar: null,
      }),
    });
    const refreshed = await loadSession(
      storeDeps(new Date(t0.getTime() + 6 * MIN), withRole),
      guildId,
      token,
    );
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.session.permissions.has('security.reports.view')).toBe(true);
      expect(refreshed.session.username).toBe('Renamed');
    }

    // Role removed in Discord → access lost → session revoked server-side.
    const noRole = fakeDiscord({
      getMember: async (_g, id) => ({
        userId: id,
        roles: [],
        joinedAt: null,
        username: 'Renamed',
        avatar: null,
      }),
    });
    const lost = await loadSession(storeDeps(new Date(t0.getTime() + 12 * MIN), noRole), guildId, token);
    expect(lost).toEqual({ ok: false, reason: 'access_lost' });
    const row = await testDb().dashboardSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(
      (await loadSession(storeDeps(new Date(t0.getTime() + 13 * MIN), withRole), guildId, token)).ok,
    ).toBe(false);
  });

  it('revokes when the member left the guild, and tolerates short Discord outages only', async () => {
    const guildId = await freshGuild();
    const userId = snowflake();
    await grant(guildId, 'USER', userId, 'dashboard.access');
    const t0 = new Date();

    const a = await newSession(guildId, { userId, now: t0 });
    const left = fakeDiscord({ getMember: async () => null });
    expect(await loadSession(storeDeps(new Date(t0.getTime() + 6 * MIN), left), guildId, a.token)).toEqual({
      ok: false,
      reason: 'access_lost',
    });

    const b = await newSession(guildId, { userId, now: t0 });
    const down = fakeDiscord({
      getMember: async () => {
        throw new Error('Discord 503');
      },
    });
    expect((await loadSession(storeDeps(new Date(t0.getTime() + 6 * MIN), down), guildId, b.token)).ok).toBe(
      true,
    );
    expect(
      await loadSession(storeDeps(new Date(t0.getTime() + PERMS_MAX_STALE_MS + MIN), down), guildId, b.token),
    ).toEqual({ ok: false, reason: 'stale' });
    const row = await testDb().dashboardSession.findUniqueOrThrow({ where: { id: b.session.id } });
    expect(row.revokedAt).toBeNull(); // an outage is not a revocation
  });

  it('authorizes only guild members with dashboard.access (owner always)', async () => {
    const guildId = await freshGuild();
    const deps = { db: testDb(), discord: fakeDiscord() };
    expect(await authorizeMember(deps, guildId, snowflake(), 'x')).toEqual({
      ok: false,
      reason: 'no_access',
    });
    expect(
      await authorizeMember(
        { ...deps, discord: fakeDiscord({ getMember: async () => null }) },
        guildId,
        snowflake(),
        'x',
      ),
    ).toEqual({ ok: false, reason: 'not_member' });
    const owner = await authorizeMember(deps, guildId, '100000000000000000', 'owner');
    expect(owner.ok && owner.actor.permissions.has('permissions.manage')).toBe(true);
    expect(
      await authorizeMember(
        {
          ...deps,
          discord: fakeDiscord({
            getGuild: async () => {
              throw new Error('down');
            },
          }),
        },
        guildId,
        snowflake(),
        'x',
      ),
    ).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('dashboard apiRoute core', () => {
  function runtime(guildId: string): ApiRuntime {
    return { deps: testDeps({ dashboardUrl: ORIGIN }), guildId, dashboardOrigin: ORIGIN };
  }
  const req = (path: string, token: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: { cookie: `gynx_session=${token}`, ...(init.headers ?? {}) },
    });

  it('denies a member without the permission (403) and audits DENIED', async () => {
    const guildId = await freshGuild();
    const userId = snowflake();
    const { token } = await newSession(guildId, { userId, permissions: ['dashboard.access'] });
    let called = false;
    const res = await executeApi(
      { permission: 'audit.view' },
      async () => {
        called = true;
        return {};
      },
      req('/api/security/audit', token),
      {},
      runtime(guildId),
    );
    expect(res.status).toBe(403);
    expect(called).toBe(false);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    const event = await testDb().securityAuditEvent.findFirst({
      where: { guildId, actorId: userId, action: 'dashboard.permission.denied' },
    });
    expect(event?.result).toBe('DENIED');
    expect(event?.source).toBe('dashboard');
    expect(event?.metadata).toMatchObject({
      required: 'audit.view',
      method: 'GET',
      path: '/api/security/audit',
    });
    expect(JSON.stringify(event?.metadata)).not.toContain(token);
  });

  it('accepts any one of several permissions, and still denies a member holding none', async () => {
    const guildId = await freshGuild();
    const opts = { permission: ['referrals.view', 'referrals.manage'] as const };
    const ok = await newSession(guildId, { permissions: ['dashboard.access', 'referrals.manage'] });
    const res = await executeApi(
      opts,
      async () => ({ ok: true }),
      req('/api/x', ok.token),
      {},
      runtime(guildId),
    );
    expect(res.status).toBe(200);

    const none = await newSession(guildId, { permissions: ['dashboard.access', 'analytics.view'] });
    const denied = await executeApi(
      opts,
      async () => ({ ok: true }),
      req('/api/x', none.token),
      {},
      runtime(guildId),
    );
    expect(denied.status).toBe(403);
  });

  it('requires CSRF token + same origin for mutations, validates input, then runs the handler', async () => {
    const guildId = await freshGuild();
    const userId = snowflake();
    const { token, session } = await newSession(guildId, {
      userId,
      permissions: ['dashboard.access', 'settings.manage'],
    });
    const rt = runtime(guildId);
    const job = await testDb().scheduledJob.create({
      data: {
        guildId,
        type: 'test.job',
        dedupeKey: `test:${snowflake()}`,
        runAt: new Date(),
        status: 'DEAD',
        attempts: 5,
        lastError: 'boom',
      },
    });
    const handler = async ({
      ctx,
      params,
    }: {
      ctx: Parameters<typeof retryJob>[0];
      params: Record<string, string>;
    }) => retryJob(ctx, params.id ?? '');

    const noToken = await executeApi(
      { permission: 'settings.manage' },
      handler,
      req('/api/jobs/x/retry', token, { method: 'POST', headers: { origin: ORIGIN } }),
      { id: job.id },
      rt,
    );
    expect(noToken.status).toBe(403);
    expect(((await noToken.json()) as { error: { code: string } }).error.code).toBe('CSRF');

    const crossOrigin = await executeApi(
      { permission: 'settings.manage' },
      handler,
      req('/api/jobs/x/retry', token, {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'x-csrf-token': session.csrfToken },
      }),
      { id: job.id },
      rt,
    );
    expect(crossOrigin.status).toBe(403);
    expect((await testDb().scheduledJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('DEAD');

    const bad = await executeApi(
      { schema: grantInputSchema },
      async () => ({}),
      req('/api/x', token, {
        method: 'POST',
        headers: { origin: ORIGIN, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
        body: '{"subjectType":"ROLE","subjectId":"not-a-snowflake","permission":"audit.view"}',
      }),
      {},
      rt,
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { issues: Array<{ path: string }> } }).error.issues[0]?.path).toBe(
      'subjectId',
    );

    const ok = await executeApi(
      { permission: 'settings.manage' },
      handler,
      req('/api/jobs/x/retry', token, {
        method: 'POST',
        headers: { origin: ORIGIN, 'x-csrf-token': session.csrfToken },
      }),
      { id: job.id },
      rt,
    );
    expect(ok.status).toBe(200);
    expect((await testDb().scheduledJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('PENDING');
    const audited = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'jobs.retry', targetId: job.id },
    });
    expect(audited?.actorId).toBe(userId);

    // Retrying again is an invalid state (no longer dead) → 409 with a safe message.
    const again = await executeApi(
      { permission: 'settings.manage' },
      handler,
      req('/api/jobs/x/retry', token, {
        method: 'POST',
        headers: { origin: ORIGIN, 'x-csrf-token': session.csrfToken },
      }),
      { id: job.id },
      rt,
    );
    expect(again.status).toBe(409);
  });

  it('rate limits per session', async () => {
    const guildId = await freshGuild();
    const { token } = await newSession(guildId);
    const rt = runtime(guildId);
    const call = () =>
      executeApi(
        { rateLimit: { limit: 2, windowSeconds: 60 } },
        async () => ({ ok: true }),
        req('/api/session', token),
        {},
        rt,
      );
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});
