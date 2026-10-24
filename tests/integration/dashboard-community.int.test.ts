import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as h from '../../apps/dashboard/src/app/api/community/_lib/handlers';
import * as sug from '../../apps/dashboard/src/app/api/engagement/_lib/suggestions';
import type { RouteDef } from '../../apps/dashboard/src/app/api/community/_lib/route-def';
import { executeApi, type ApiRuntime } from '../../apps/dashboard/src/server/api-core';
import { createSession } from '../../apps/dashboard/src/server/session-store';
import { fakeDiscord, freshGuild, snowflake, testDb, testDeps, type FakeDiscord } from './helpers';

const ORIGIN = 'https://dash.test';
const BOT_ID = '199999999999999999';

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

/** Discord fake with a role list and a bot member whose highest role sits at position 10. */
function discordWithRoles(
  guildId: string,
  roles: Array<{ id: string; position: number; managed?: boolean; permissions?: string }>,
): FakeDiscord {
  const botRole = { id: snowflake(), name: 'GYNX Bot', position: 10, managed: true, permissions: '8' };
  const all = [
    { id: guildId, name: '@everyone', position: 0, managed: false, permissions: '0' },
    botRole,
    ...roles.map((r) => ({ name: 'role', managed: false, permissions: '0', ...r })),
  ];
  return fakeDiscord({
    listRoles: async () => all,
    getMember: async (_g, userId) => ({
      userId,
      roles: userId === BOT_ID ? [botRole.id] : [],
      joinedAt: null,
      username: 'x',
      avatar: null,
    }),
  });
}

function rt(guildId: string, discord: FakeDiscord = fakeDiscord()): ApiRuntime {
  return { deps: { ...testDeps({ dashboardUrl: ORIGIN }), discord }, guildId, dashboardOrigin: ORIGIN };
}

type Session = Awaited<ReturnType<typeof newSession>>;

function call(
  def: Pick<RouteDef<undefined>, 'opts'> & { handler: unknown },
  runtime: ApiRuntime,
  opts: {
    session?: Session;
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
    csrf?: boolean;
    query?: string;
  } = {},
) {
  const method = opts.method ?? (def.opts.mutation ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (opts.session) headers.cookie = `gynx_session=${opts.session.token}`;
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    if (opts.csrf !== false && opts.session) headers['x-csrf-token'] = opts.session.session.csrfToken;
  }
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`${ORIGIN}/api/test${opts.query ?? ''}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return executeApi(def.opts as never, def.handler as never, req, opts.params ?? {}, runtime);
}

const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
type ErrBody = { error: { code: string; message: string; issues?: Array<{ path: string }> } };

describe('dashboard community API', () => {
  const prevClientId = process.env.DISCORD_OAUTH_CLIENT_ID;
  beforeAll(() => {
    process.env.DISCORD_OAUTH_CLIENT_ID = BOT_ID;
  });
  afterAll(async () => {
    process.env.DISCORD_OAUTH_CLIENT_ID = prevClientId;
    await testDb().$disconnect();
  });

  it('rejects unauthenticated requests (401)', async () => {
    const guildId = await freshGuild();
    const res = await call(h.getWelcome, rt(guildId));
    expect(res.status).toBe(401);
    expect((await json<ErrBody>(res)).error.code).toBe('UNAUTHENTICATED');
    const post = await call(h.createFaqEntry, rt(guildId), {
      body: { question: 'How do I pay?', answer: 'Card.' },
    });
    expect(post.status).toBe(401);
  });

  it('forbids members without community.manage (403) and audits the denial', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['suggestions.manage']);
    const res = await call(h.createFaqEntry, rt(guildId), {
      session: s,
      body: { question: 'How do I pay?', answer: 'Card.' },
    });
    expect(res.status).toBe(403);
    expect((await json<ErrBody>(res)).error.code).toBe('FORBIDDEN');
    expect(await testDb().faqEntry.count({ where: { guildId } })).toBe(0);
    const denied = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'dashboard.permission.denied' },
    });
    expect(denied?.metadata).toMatchObject({ required: 'community.manage' });
  });

  it('requires the CSRF token for mutations (403)', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['community.manage']);
    const res = await call(h.createFaqEntry, rt(guildId), {
      session: s,
      csrf: false,
      body: { question: 'How do I pay?', answer: 'Card.' },
    });
    expect(res.status).toBe(403);
    expect((await json<ErrBody>(res)).error.code).toBe('CSRF');
    expect(await testDb().faqEntry.count({ where: { guildId } })).toBe(0);
  });

  it('creates a FAQ category and entry, lists drafts, edits and deletes', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['community.manage']);
    const r = rt(guildId);
    const cat = await call(h.createFaqCategory, r, { session: s, body: { name: 'Billing & payments' } });
    expect(cat.status).toBe(200);
    const category = await json<{ id: string; slug: string }>(cat);
    expect(category.slug).toBe('billing-payments');

    const bad = await call(h.createFaqEntry, r, {
      session: s,
      body: { question: 'Pay?', answer: 'x', links: [{ label: 'Docs', url: 'http://insecure.example' }] },
    });
    expect(bad.status).toBe(400);
    expect((await json<ErrBody>(bad)).error.issues?.map((i) => i.path)).toEqual(
      expect.arrayContaining(['question', 'links.0.url']),
    );

    const created = await call(h.createFaqEntry, r, {
      session: s,
      body: {
        categoryId: category.id,
        question: 'How do I pay my invoice?',
        answer: 'Use the **billing** page.',
        keywords: ['Invoice', 'invoice'],
        links: [{ label: 'Billing', url: 'https://gynx.gg/billing' }],
      },
    });
    expect(created.status).toBe(200);
    const entry = await json<{ id: string; published: boolean; keywords: string[] }>(created);
    expect(entry.published).toBe(false);
    expect(entry.keywords).toEqual(['invoice']);

    const list = await call(h.listFaqEntries, r, { session: s, query: '?published=false' });
    expect(list.status).toBe(200);
    expect((await json<{ items: Array<{ id: string }> }>(list)).items.map((e) => e.id)).toEqual([entry.id]);

    const pub = await call(h.updateFaqEntry, r, {
      session: s,
      method: 'PATCH',
      params: { id: entry.id },
      body: { published: true },
    });
    expect(pub.status).toBe(200);
    expect((await testDb().faqEntry.findUniqueOrThrow({ where: { id: entry.id } })).published).toBe(true);

    const del = await call(h.deleteFaqEntry, r, { session: s, method: 'DELETE', params: { id: entry.id } });
    expect(del.status).toBe(200);
    expect(await testDb().faqEntry.count({ where: { guildId } })).toBe(0);
    const audit = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'community.faq.delete', targetId: entry.id },
    });
    expect(audit?.actorId).toBe(s.session.userId);
  });

  it('adds self-roles only when the live Discord role is safe', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['community.manage']);
    const safe = snowflake();
    const admin = snowflake();
    const above = snowflake();
    const r = rt(
      guildId,
      discordWithRoles(guildId, [
        { id: safe, position: 3 },
        { id: admin, position: 4, permissions: '8' },
        { id: above, position: 12 },
      ]),
    );

    const ok = await call(h.createSelfRole, r, {
      session: s,
      body: { roleId: safe, label: 'Minecraft', group: 'games', emoji: '🎮' },
    });
    expect(ok.status).toBe(200);
    expect(await testDb().selfAssignableRole.count({ where: { guildId, roleId: safe } })).toBe(1);

    const privileged = await call(h.createSelfRole, r, {
      session: s,
      body: { roleId: admin, label: 'Admin' },
    });
    expect(privileged.status).toBe(400);
    expect((await json<ErrBody>(privileged)).error.message).toMatch(
      /privileged permissions \(Administrator\)/,
    );

    const tooHigh = await call(h.createSelfRole, r, { session: s, body: { roleId: above, label: 'Above' } });
    expect(tooHigh.status).toBe(400);
    expect((await json<ErrBody>(tooHigh)).error.message).toMatch(/at or above the bot's highest role/);

    const missing = await call(h.createSelfRole, r, {
      session: s,
      body: { roleId: snowflake(), label: 'Ghost' },
    });
    expect(missing.status).toBe(400);
    expect((await json<ErrBody>(missing)).error.message).toMatch(/no longer exists/);
    expect(await testDb().selfAssignableRole.count({ where: { guildId } })).toBe(1);
  });

  it('validates the verified role live when the welcome config changes it', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['community.manage']);
    const verified = snowflake();
    const managed = snowflake();
    const r = rt(
      guildId,
      discordWithRoles(guildId, [
        { id: verified, position: 2 },
        { id: managed, position: 3, managed: true },
      ]),
    );

    const placeholder = await call(h.updateWelcome, r, {
      session: s,
      method: 'PUT',
      body: { message: 'Hi {nick}' },
    });
    expect(placeholder.status).toBe(400);

    const rejected = await call(h.updateWelcome, r, {
      session: s,
      method: 'PUT',
      body: { verificationEnabled: true, verifiedRoleId: managed },
    });
    expect(rejected.status).toBe(400);
    expect((await json<ErrBody>(rejected)).error.message).toMatch(/managed roles cannot be self-assigned/i);

    const ok = await call(h.updateWelcome, r, {
      session: s,
      method: 'PUT',
      body: {
        verificationEnabled: true,
        verifiedRoleId: verified,
        title: 'Welcome!',
        supportUrl: 'https://help.gynx.gg',
      },
    });
    expect(ok.status).toBe(200);
    const cfg = await testDb().welcomeConfig.findUniqueOrThrow({ where: { guildId } });
    expect(cfg).toMatchObject({
      verificationEnabled: true,
      verifiedRoleId: verified,
      title: 'Welcome!',
      supportUrl: 'https://help.gynx.gg',
    });
  });

  it('creates a guide', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['community.manage']);
    const res = await call(h.createGuide, rt(guildId), {
      session: s,
      body: {
        title: 'Install Paper on your server',
        category: 'Setup',
        game: 'Minecraft',
        summary: 'Step by step.',
        url: 'https://docs.gynx.gg/paper',
        published: true,
      },
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ slug: 'install-paper-on-your-server', published: true });
  });

  it('lets suggestion moderators set a status and hide a suggestion (suggestions.manage)', async () => {
    const guildId = await freshGuild();
    const db = testDb();
    const suggestion = await db.suggestion.create({
      data: {
        guildId,
        number: 1,
        ref: 'S-0001',
        authorId: snowflake(),
        title: 'Add a Rust template',
        body: 'It would be great to have a Rust server template.',
      },
    });
    const original = await db.suggestion.create({
      data: {
        guildId,
        number: 2,
        ref: 'S-0002',
        authorId: snowflake(),
        title: 'Rust template',
        body: 'Same idea as before, posted earlier.',
      },
    });
    const r = rt(guildId);

    const communityOnly = await newSession(guildId, ['community.manage']);
    const denied = await call(sug.setSuggestionStatus, r, {
      session: communityOnly,
      params: { id: suggestion.id },
      body: { status: 'PLANNED' },
    });
    expect(denied.status).toBe(403);

    const mod = await newSession(guildId, ['suggestions.manage']);
    const noDup = await call(sug.setSuggestionStatus, r, {
      session: mod,
      params: { id: suggestion.id },
      body: { status: 'DUPLICATE' },
    });
    expect(noDup.status).toBe(400);

    const ok = await call(sug.setSuggestionStatus, r, {
      session: mod,
      params: { id: suggestion.id },
      body: { status: 'DUPLICATE', duplicateOf: 's-0002', response: 'Tracking in S-0002.' },
    });
    expect(ok.status).toBe(200);
    expect(await db.suggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).toMatchObject({
      status: 'DUPLICATE',
      duplicateOfId: original.id,
      staffResponse: 'Tracking in S-0002.',
    });

    const hide = await call(sug.setSuggestionHidden, r, {
      session: mod,
      params: { id: original.id },
      body: { hidden: true, reason: 'spam' },
    });
    expect(hide.status).toBe(200);
    const listed = await call(sug.listSuggestions, r, { session: mod, query: '?includeHidden=true' });
    const items = (await json<{ items: Array<{ id: string; hidden: boolean }> }>(listed)).items;
    expect(items.find((i) => i.id === original.id)?.hidden).toBe(true);
    const visible = await call(sug.listSuggestions, r, { session: mod });
    expect((await json<{ items: Array<{ id: string }> }>(visible)).items.map((i) => i.id)).toEqual([
      suggestion.id,
    ]);
  });
});
