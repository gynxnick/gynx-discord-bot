import { randomInt } from 'node:crypto';
import { ensureGuild } from '@gynx/database';
import { afterAll, describe, expect, it } from 'vitest';
import { troubleshooting } from '@gynx/services';
import { ctxAs, testDb, testDeps } from './helpers';

/** helpers.snowflake() is only unique per worker; a random guild id keeps parallel test files from colliding. */
async function freshGuild(): Promise<string> {
  const id = `9${String(randomInt(1e9)).padStart(9, '0')}${String(randomInt(1e9)).padStart(9, '0')}`;
  await ensureGuild(testDb(), id, `Test Guild ${id}`);
  return id;
}

const article = {
  slug: 'test-article',
  title: 'Test: Server will not start',
  summary: 'A test article about a server that will not start.',
  body: 'Check the logs and the configuration before restarting the server.',
  game: 'minecraft',
  tags: ['startup'],
};

const CDN = 'https://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/latest.log';
const textFetch = (text: string) =>
  (async () => new Response(text, { status: 200 })) as unknown as typeof fetch;

describe('troubleshooting: knowledge base', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('enforces troubleshooting.manage for CRUD, audits changes and prevents duplicate slugs', async () => {
    const guildId = await freshGuild();
    const member = ctxAs(guildId);
    const staff = ctxAs(guildId, ['troubleshooting.manage']);

    await expect(troubleshooting.createArticle(member, article)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const denied = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'troubleshooting.article.create', result: 'DENIED' },
    });
    expect(denied).not.toBeNull();

    const a = await troubleshooting.createArticle(staff, {
      ...article,
      body: `${article.body} password=hunter22`,
    });
    expect(a.published).toBe(false);
    expect(a.body).not.toContain('hunter22');
    await expect(troubleshooting.createArticle(staff, article)).rejects.toMatchObject({ code: 'CONFLICT' });

    // Drafts are invisible to members.
    await expect(troubleshooting.getArticle(member, a.slug)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await troubleshooting.getArticle(staff, a.slug)).id).toBe(a.id);

    await expect(troubleshooting.updateArticle(member, a.id, { published: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await troubleshooting.setArticlePublished(staff, a.id, true);
    const viewed = await troubleshooting.viewArticle(member, a.slug);
    expect(viewed.views).toBe(1);

    await expect(troubleshooting.listArticles(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await troubleshooting.listArticles(staff)).items).toHaveLength(1);

    // Cross-guild isolation.
    const otherStaff = ctxAs(await freshGuild(), ['troubleshooting.manage']);
    await expect(
      troubleshooting.updateArticle(otherStaff, a.id, { title: 'Hijacked title' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(troubleshooting.deleteArticle(member, a.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await troubleshooting.deleteArticle(staff, a.id);
    const actions = (
      await testDb().securityAuditEvent.findMany({
        where: { guildId, result: 'SUCCESS' },
        select: { action: true },
      })
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'troubleshooting.article.create',
        'troubleshooting.article.update',
        'troubleshooting.article.delete',
      ]),
    );
  });

  it('lets members vote once per article', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['troubleshooting.manage']);
    const a = await troubleshooting.createArticle(staff, { ...article, published: true });
    const member = ctxAs(guildId);
    expect(await troubleshooting.voteArticle(member, a.id, true)).toEqual({ helpfulYes: 1, helpfulNo: 0 });
    await expect(troubleshooting.voteArticle(member, a.id, false)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('seeds default content idempotently without overwriting staff edits', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['troubleshooting.manage']);
    await expect(troubleshooting.seedDefaultContent(ctxAs(guildId))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const first = await troubleshooting.seedDefaultContent(staff);
    expect(first).toEqual({
      articlesCreated: troubleshooting.SEED_ARTICLES.length,
      flowsCreated: troubleshooting.SEED_FLOWS.length,
    });

    const edited = await testDb().knowledgeArticle.findUniqueOrThrow({
      where: { guildId_slug: { guildId, slug: 'minecraft-eula' } },
    });
    await troubleshooting.updateArticle(staff, edited.id, { title: 'Our custom EULA article' });

    const second = await troubleshooting.seedDefaultContent(staff);
    expect(second).toEqual({ articlesCreated: 0, flowsCreated: 0 });
    expect(await testDb().knowledgeArticle.count({ where: { guildId } })).toBe(
      troubleshooting.SEED_ARTICLES.length,
    );
    expect(await testDb().troubleshootingFlow.count({ where: { guildId } })).toBe(
      troubleshooting.SEED_FLOWS.length,
    );
    expect((await testDb().knowledgeArticle.findUniqueOrThrow({ where: { id: edited.id } })).title).toBe(
      'Our custom EULA article',
    );
  });

  it('searches published articles with ranking, game filter and pagination', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['troubleshooting.manage']);
    await troubleshooting.seedDefaultContent(staff);
    await troubleshooting.createArticle(staff, {
      ...article,
      slug: 'draft-java',
      title: 'Draft about Java version',
      published: false,
    });
    const member = ctxAs(guildId);

    const java = await troubleshooting.searchArticles(member, { query: 'java version crash' });
    expect(java.items[0]!.article.slug).toBe('minecraft-java-version');
    expect(java.items.some((h) => h.article.slug === 'draft-java')).toBe(false);

    const valheim = await troubleshooting.searchArticles(member, { query: 'password', game: 'valheim' });
    expect(valheim.items[0]!.article.slug).toBe('valheim-crossplay-password');
    expect(valheim.items.every((h) => h.article.game === 'valheim' || h.article.game === null)).toBe(true);

    const page1 = await troubleshooting.searchArticles(member, { query: 'minecraft server', limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBe('2');
    const page2 = await troubleshooting.searchArticles(member, {
      query: 'minecraft server',
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items.map((h) => h.article.id)).not.toContain(page1.items[0]!.article.id);

    const empty = await troubleshooting.searchArticles(member, { query: 'zzzqqq xyzzy' });
    expect(empty.items).toEqual([]);

    const ac = await troubleshooting.autocompleteArticles(member, 'gar');
    expect(ac.map((r) => r.slug)).toContain('gmod-missing-content');
  });
});

describe('troubleshooting: flows and sessions', () => {
  it('validates flow definitions and article references on save', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['troubleshooting.manage']);
    const base = { slug: 'my-flow', title: 'My flow', description: 'A custom flow', published: true };
    await expect(
      troubleshooting.createFlow(staff, {
        ...base,
        definition: {
          start: 'a',
          nodes: { a: { prompt: 'Q', options: [{ label: 'Read', articleSlug: 'missing-article' }] } },
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      troubleshooting.createFlow(staff, {
        ...base,
        definition: { start: 'a', nodes: { a: { prompt: 'Q', options: [{ label: 'Loop', next: 'a' }] } } },
      }),
    ).rejects.toThrow(/never reach an outcome/);
    await expect(
      troubleshooting.createFlow(ctxAs(guildId), { ...base, definition: {} }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const f = await troubleshooting.createFlow(staff, {
      ...base,
      definition: { start: 'a', nodes: { a: { prompt: 'Q', options: [{ label: 'Fixed', resolve: true }] } } },
    });
    const updated = await troubleshooting.updateFlow(staff, f.id, {
      definition: {
        start: 'b',
        nodes: { b: { prompt: 'Q2', options: [{ label: 'Help', escalate: true }] } },
      },
    });
    expect(updated.version).toBe(2);
  });

  it('only the session owner can advance; records the path and outcome; rejects stale clicks', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({
      where: { guildId },
      data: { supportUrl: 'https://support.example.com/new' },
    });
    const deps = testDeps();
    const staff = ctxAs(guildId, ['troubleshooting.manage'], { deps });
    await troubleshooting.seedDefaultContent(staff);

    const owner = ctxAs(guildId, [], { deps });
    const intruder = ctxAs(guildId, ['troubleshooting.manage'], { deps });

    const flows = await troubleshooting.listFlows(owner, { game: 'minecraft' });
    expect(flows.map((f) => f.slug)).toContain('minecraft-cant-connect');

    const step1 = await troubleshooting.startSession(owner, 'minecraft-cant-connect');
    expect(step1.kind).toBe('node');
    if (step1.kind !== 'node') return;
    expect(step1.nodeId).toBe('error');

    await expect(troubleshooting.chooseOption(intruder, step1.sessionId, 0, 'error')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      await testDb().securityAuditEvent.count({
        where: { guildId, action: 'troubleshooting.session.advance', result: 'DENIED' },
      }),
    ).toBe(1);

    const step2 = await troubleshooting.chooseOption(owner, step1.sessionId, 0, 'error'); // "Connection timed out"
    expect(step2).toMatchObject({ kind: 'node', nodeId: 'timeout' });
    // Stale button from the first message.
    await expect(troubleshooting.chooseOption(owner, step1.sessionId, 1, 'error')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(troubleshooting.chooseOption(owner, step1.sessionId, 4, 'timeout')).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    const end = await troubleshooting.chooseOption(owner, step1.sessionId, 1, 'timeout'); // "No / not sure" → article
    expect(end).toMatchObject({
      kind: 'resolved',
      article: { slug: 'minecraft-cant-connect' },
      supportUrl: 'https://support.example.com/new',
    });

    let s = await testDb().troubleshootingSession.findUniqueOrThrow({ where: { id: step1.sessionId } });
    expect(s.outcome).toBe('RESOLVED');
    expect(s.path).toEqual(['error:0', 'timeout:1']);
    await expect(troubleshooting.chooseOption(owner, step1.sessionId, 0)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });

    // "Still stuck" after a resolution escalates — owner only.
    await expect(troubleshooting.escalateSession(intruder, step1.sessionId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await troubleshooting.escalateSession(owner, step1.sessionId)).toEqual({
      supportUrl: 'https://support.example.com/new',
    });
    s = await testDb().troubleshootingSession.findUniqueOrThrow({ where: { id: step1.sessionId } });
    expect(s.outcome).toBe('ESCALATED');
  });

  it('escalate options end the session as ESCALATED and work without a supportUrl', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['troubleshooting.manage']);
    await troubleshooting.seedDefaultContent(staff);
    const member = ctxAs(guildId);
    const start = await troubleshooting.startSession(member, 'minecraft-cant-connect');
    const end = await troubleshooting.chooseOption(member, start.sessionId, 4); // "Something else"
    expect(end).toMatchObject({ kind: 'escalated', supportUrl: null });
    // Restarting the same flow abandons any older in-progress session.
    const a = await troubleshooting.startSession(member, 'minecraft-crash-startup');
    await troubleshooting.startSession(member, 'minecraft-crash-startup');
    expect(
      (await testDb().troubleshootingSession.findUniqueOrThrow({ where: { id: a.sessionId } })).outcome,
    ).toBe('ABANDONED');
    await expect(troubleshooting.startSession(member, 'does-not-exist')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('troubleshooting: diagnostics', () => {
  it('stores only redacted findings + excerpt with an expiry, never the raw upload', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { diagnosticRetentionHours: 6 } });
    const now = new Date('2026-01-01T00:00:00Z');
    const deps = testDeps({ now: () => now });
    const member = ctxAs(guildId, [], { deps });
    const log = [
      '[10:00:00] [Server thread/INFO]: Starting minecraft server version 1.21.1',
      'rcon.password=secret',
      '[10:00:01] [Server thread/WARN]: **** FAILED TO BIND TO PORT! 51.38.12.99:25565',
      '[10:00:01] [Server thread/WARN]: The exception was: java.net.BindException: Address already in use',
    ].join('\n');

    const out = await troubleshooting.runDiagnosis(
      member,
      { attachment: { url: CDN, name: 'latest.log', size: log.length, contentType: 'text/plain' } },
      { fetchImpl: textFetch(log) },
    );
    expect(out.findings.map((f) => f.id)).toContain('mc-port-in-use');
    const rec = await testDb().diagnosticRecord.findUniqueOrThrow({ where: { id: out.recordId } });
    expect(rec.expiresAt.toISOString()).toBe('2026-01-01T06:00:00.000Z');
    const stored = JSON.stringify(rec);
    expect(stored).not.toContain('secret');
    expect(stored).not.toContain('51.38.12.99');
    expect(rec.redactedExcerpt!.length).toBeLessThanOrEqual(1500);
    const auditRow = await testDb().securityAuditEvent.findFirstOrThrow({
      where: { guildId, action: 'troubleshooting.diagnose' },
    });
    expect(JSON.stringify(auditRow.metadata)).not.toMatch(/BIND|secret|Address/);

    // Feedback: owner only.
    await expect(
      troubleshooting.diagnosticFeedback(ctxAs(guildId, [], { deps }), out.recordId, false),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await troubleshooting.diagnosticFeedback(member, out.recordId, false);
    expect(
      (await testDb().diagnosticRecord.findUniqueOrThrow({ where: { id: out.recordId } })).escalated,
    ).toBe(true);
  });

  it('rejects binary and non-CDN uploads before storing anything', async () => {
    const guildId = await freshGuild();
    const member = ctxAs(guildId);
    const bin = '\x00\x01\x02PK';
    await expect(
      troubleshooting.runDiagnosis(
        member,
        { attachment: { url: CDN, name: 'latest.log', size: 5, contentType: 'application/octet-stream' } },
        { fetchImpl: textFetch(bin) },
      ),
    ).rejects.toThrow(/looks binary/);
    await expect(
      troubleshooting.runDiagnosis(member, {
        attachment: { url: 'https://evil.example/attachments/a.log', name: 'a.log', size: 5 },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await testDb().diagnosticRecord.count({ where: { guildId } })).toBe(0);
  });
});
