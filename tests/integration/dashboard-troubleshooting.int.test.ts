import { afterAll, describe, expect, it } from 'vitest';
import { integrationHandlers } from '../../apps/dashboard/src/app/api/integrations/handlers';
import { troubleshootingHandlers as th } from '../../apps/dashboard/src/app/api/troubleshooting/handlers';
import { executeApi, type ApiRuntime } from '../../apps/dashboard/src/server/api-core';
import { createSession } from '../../apps/dashboard/src/server/session-store';
import { freshGuild, snowflake, testDb, testDeps } from './helpers';

const ORIGIN = 'https://dash.test';

function runtime(guildId: string): ApiRuntime {
  return { deps: testDeps({ dashboardUrl: ORIGIN }), guildId, dashboardOrigin: ORIGIN };
}

async function newSession(guildId: string, permissions: string[]) {
  return createSession(
    testDb(),
    {
      userId: snowflake(),
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
}

interface Call {
  method?: string;
  token?: string;
  csrf?: string | null;
  body?: unknown;
  params?: Record<string, string>;
}

/** Drive a handler definition through the real apiRoute core. */
async function call<D extends { opts: object; handler: unknown }>(
  def: D,
  guildId: string,
  path: string,
  c: Call = {},
): Promise<Response> {
  const method = c.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (c.token) headers.cookie = `gynx_session=${c.token}`;
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    if (c.csrf) headers['x-csrf-token'] = c.csrf;
  }
  if (c.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
  });
  return executeApi(def.opts as never, def.handler as never, req, c.params ?? {}, runtime(guildId));
}

const article = {
  slug: 'test-article',
  title: 'Test article',
  summary: 'A summary for the test article.',
  body: 'Body text that is long enough for the schema.',
  tags: ['test'],
  published: true,
};

describe('dashboard troubleshooting API', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const guildId = await freshGuild();
    const res = await call(th.listArticles, guildId, '/api/troubleshooting/articles');
    expect(res.status).toBe(401);
    const post = await call(th.createArticle, guildId, '/api/troubleshooting/articles', {
      method: 'POST',
      body: article,
    });
    expect(post.status).toBe(401);
  });

  it('denies a member without troubleshooting.manage / settings.manage (403)', async () => {
    const guildId = await freshGuild();
    const { token, session } = await newSession(guildId, []);
    const res = await call(th.createArticle, guildId, '/api/troubleshooting/articles', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: article,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    expect(await testDb().knowledgeArticle.count({ where: { guildId } })).toBe(0);

    const ai = await call(integrationHandlers.upsert, guildId, '/api/integrations', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: { kind: 'AI_PROVIDER', name: 'x', enabled: true },
    });
    expect(ai.status).toBe(403);
  });

  it('creates, lists, updates and deletes an article', async () => {
    const guildId = await freshGuild();
    const { token, session } = await newSession(guildId, ['troubleshooting.manage']);
    const res = await call(th.createArticle, guildId, '/api/troubleshooting/articles', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: article,
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { id: string; slug: string; published: boolean };
    expect(created).toMatchObject({ slug: 'test-article', published: true });

    const list = await call(th.listArticles, guildId, '/api/troubleshooting/articles?published=true', {
      token,
    });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: Array<{ id: string }> }).items.map((a) => a.id)).toEqual([
      created.id,
    ]);

    const upd = await call(th.updateArticle, guildId, '/api/troubleshooting/articles/x', {
      method: 'PATCH',
      token,
      csrf: session.csrfToken,
      body: { published: false },
      params: { id: created.id },
    });
    expect(upd.status).toBe(200);
    expect((await testDb().knowledgeArticle.findUniqueOrThrow({ where: { id: created.id } })).published).toBe(
      false,
    );

    const dup = await call(th.createArticle, guildId, '/api/troubleshooting/articles', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: article,
    });
    expect(dup.status).toBe(409);

    const del = await call(th.deleteArticle, guildId, '/api/troubleshooting/articles/x', {
      method: 'DELETE',
      token,
      csrf: session.csrfToken,
      params: { id: created.id },
    });
    expect(del.status).toBe(200);
    expect(await testDb().knowledgeArticle.count({ where: { guildId } })).toBe(0);
    const audited = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'troubleshooting.article.delete', targetId: created.id },
    });
    expect(audited?.actorId).toBe(session.userId);
  });

  it('returns the service validation error for an invalid flow definition', async () => {
    const guildId = await freshGuild();
    const { token, session } = await newSession(guildId, ['troubleshooting.manage']);
    const definition = {
      start: 'a',
      nodes: { a: { prompt: 'Start?', options: [{ label: 'Go', next: 'missing' }] } },
    };
    const flow = { slug: 'bad-flow', title: 'Bad flow', description: 'A flow that is invalid.', definition };

    const res = await call(th.createFlow, guildId, '/api/troubleshooting/flows', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: flow,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toContain('Node "a" option 1 points to unknown node "missing".');
    expect(await testDb().troubleshootingFlow.count({ where: { guildId } })).toBe(0);

    const dry = await call(th.validateFlow, guildId, '/api/troubleshooting/flows/validate', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: { definition },
    });
    expect(dry.status).toBe(200);
    expect(await dry.json()).toEqual({
      ok: false,
      errors: ['Node "a" option 1 points to unknown node "missing".'],
    });

    // Fixed definition saves, and stats/list include it.
    const ok = await call(th.createFlow, guildId, '/api/troubleshooting/flows', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: {
        ...flow,
        slug: 'good-flow',
        definition: {
          start: 'a',
          nodes: { a: { prompt: 'Start?', options: [{ label: 'Done', resolve: true }] } },
        },
      },
    });
    expect(ok.status).toBe(200);
    const list = (await (
      await call(th.listFlows, guildId, '/api/troubleshooting/flows', { token })
    ).json()) as { items: Array<{ slug: string }>; stats: unknown[] };
    expect(list.items.map((f) => f.slug)).toEqual(['good-flow']);
  });

  it('stores an AI provider key write-only: responses carry hasSecret, never the secret', async () => {
    const guildId = await freshGuild();
    const { token, session } = await newSession(guildId, ['settings.manage']);
    const secret = 'sk-test-SUPERSECRET-value-1234567890';
    const res = await call(integrationHandlers.upsert, guildId, '/api/integrations', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: {
        kind: 'AI_PROVIDER',
        name: 'openai',
        enabled: true,
        settings: { model: 'gpt-test', baseUrl: 'https://api.example.com/v1', maxTokens: 800 },
        secret,
      },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(secret);
    const json = JSON.parse(text) as Record<string, unknown>;
    expect(json.hasSecret).toBe(true);
    expect(json).not.toHaveProperty('secret');
    expect(json).not.toHaveProperty('secretEnc');

    const row = await testDb().integrationConfig.findFirstOrThrow({
      where: { guildId, kind: 'AI_PROVIDER', name: 'openai' },
    });
    expect(row.secretEnc).toBeTruthy();
    expect(row.secretEnc).not.toContain(secret);

    const list = await call(integrationHandlers.list, guildId, '/api/integrations?kind=AI_PROVIDER', {
      token,
    });
    const listText = await list.text();
    expect(list.status).toBe(200);
    expect(listText).not.toContain(secret);
    expect(listText).not.toContain(row.secretEnc!);
    expect((JSON.parse(listText) as { items: Array<{ hasSecret: boolean }> }).items[0]?.hasSecret).toBe(true);

    // Updating without a secret keeps it; https-only base URL; secrets rejected in settings.
    const keep = await call(integrationHandlers.upsert, guildId, '/api/integrations', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: { kind: 'AI_PROVIDER', name: 'openai', enabled: false },
    });
    expect(((await keep.json()) as { hasSecret: boolean }).hasSecret).toBe(true);
    const http = await call(integrationHandlers.upsert, guildId, '/api/integrations', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: {
        kind: 'AI_PROVIDER',
        name: 'openai',
        enabled: true,
        settings: { baseUrl: 'http://api.example.com' },
      },
    });
    expect(http.status).toBe(400);
    const leak = await call(integrationHandlers.upsert, guildId, '/api/integrations', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: { kind: 'AI_PROVIDER', name: 'openai', enabled: true, settings: { apiKey: 'sk-oops' } },
    });
    expect(leak.status).toBe(400);

    // Removing the key.
    const removed = await call(integrationHandlers.upsert, guildId, '/api/integrations', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
      body: { kind: 'AI_PROVIDER', name: 'openai', enabled: false, secret: '' },
    });
    expect(((await removed.json()) as { hasSecret: boolean }).hasSecret).toBe(false);
  });

  it('rejects mutations without a CSRF token (403) and changes nothing', async () => {
    const guildId = await freshGuild();
    const { token } = await newSession(guildId, ['troubleshooting.manage', 'settings.manage']);
    const res = await call(th.createArticle, guildId, '/api/troubleshooting/articles', {
      method: 'POST',
      token,
      csrf: null,
      body: article,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CSRF');
    expect(await testDb().knowledgeArticle.count({ where: { guildId } })).toBe(0);

    const seed = await call(th.seed, guildId, '/api/troubleshooting/seed', {
      method: 'POST',
      token,
      csrf: null,
    });
    expect(seed.status).toBe(403);
    const ai = await call(integrationHandlers.upsert, guildId, '/api/integrations', {
      method: 'POST',
      token,
      csrf: null,
      body: { kind: 'AI_PROVIDER', name: 'x', enabled: true, secret: 's' },
    });
    expect(ai.status).toBe(403);
    expect(await testDb().integrationConfig.count({ where: { guildId } })).toBe(0);
  });

  it('seeds default content idempotently without overwriting edits', async () => {
    const guildId = await freshGuild();
    const { token, session } = await newSession(guildId, ['troubleshooting.manage']);
    const first = await call(th.seed, guildId, '/api/troubleshooting/seed', {
      method: 'POST',
      token,
      csrf: session.csrfToken,
    });
    expect(first.status).toBe(200);
    const r1 = (await first.json()) as { articlesCreated: number; flowsCreated: number };
    expect(r1.articlesCreated).toBeGreaterThan(0);
    const a = await testDb().knowledgeArticle.findFirstOrThrow({ where: { guildId } });
    await testDb().knowledgeArticle.update({ where: { id: a.id }, data: { title: 'Edited by staff' } });
    const second = (await (
      await call(th.seed, guildId, '/api/troubleshooting/seed', {
        method: 'POST',
        token,
        csrf: session.csrfToken,
      })
    ).json()) as typeof r1;
    expect(second).toEqual({ articlesCreated: 0, flowsCreated: 0 });
    expect((await testDb().knowledgeArticle.findUniqueOrThrow({ where: { id: a.id } })).title).toBe(
      'Edited by staff',
    );
  });
});
