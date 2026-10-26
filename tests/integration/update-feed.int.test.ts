import { randomUUID } from 'node:crypto';
import { DiscordAPIError } from '@discordjs/rest';
import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { updates } from '@gynx/services';
import {
  createRepoRoute,
  deleteRepoRoute,
  listEventsRoute,
  listReposRoute,
  updateRepoRoute,
} from '../../apps/dashboard/src/app/api/updates/handlers';
import { executeApi } from '../../apps/dashboard/src/server/api-core';
import { handleGithubWebhook } from '../../apps/dashboard/src/server/github-webhook';
import { createSession } from '../../apps/dashboard/src/server/session-store';
import { JobRunner } from '../../apps/worker/src/framework/runner';
import { updatesJobs } from '../../apps/worker/src/jobs/updates';
import { ctxAs, drainJobs, freshGuild, silentLog, snowflake, testDb, testDeps } from './helpers';

const SECRET = 'integration-webhook-secret-0123456789';
const ORIGIN = 'https://dash.test';
/** Built at runtime so no token-shaped literal lives in the repository. */
const fakeGithubToken = () => ['gh', 'p_', 'Mn4'.repeat(12)].join('');

type Deps = ReturnType<typeof testDeps>;

async function setup(opts: { channels?: boolean; publicEnabled?: boolean; branch?: string | null } = {}) {
  const guildId = await freshGuild();
  const staffChannel = snowflake();
  const publicChannel = snowflake();
  if (opts.channels !== false) {
    await testDb().guildConfig.update({
      where: { guildId },
      data: { updatesStaffChannelId: staffChannel, updatesChannelId: publicChannel },
    });
  }
  const deps = testDeps();
  const admin = ctxAs(guildId, ['updates.manage'], { deps });
  const repo = await updates.upsertRepo(admin, {
    fullName: 'GYNX-GG/Website',
    displayName: 'Website',
    color: '#22d3ee',
    branch: opts.branch ?? null,
    publicEnabled: opts.publicEnabled ?? true,
  });
  const runner = new JobRunner(
    {
      deps,
      env: { DISCORD_GUILD_ID: guildId, DASHBOARD_URL: ORIGIN } as WorkerEnv,
      log: silentLog,
      workerId: 't',
    },
    [updatesJobs],
  );
  const staffPosts = () => deps.discord.sent.filter((m) => m.channelId === staffChannel);
  const publicPosts = () => deps.discord.sent.filter((m) => m.channelId === publicChannel);
  return { guildId, deps, admin, repo, runner, staffChannel, publicChannel, staffPosts, publicPosts };
}

function deliver(
  guildId: string,
  deps: Deps,
  event: string,
  payload: unknown,
  opts: {
    secret?: string | undefined;
    signWith?: string;
    deliveryId?: string;
    signature?: string | null;
  } = {},
) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-github-event': event,
    'x-github-delivery': opts.deliveryId ?? randomUUID(),
    'x-forwarded-for': '192.0.2.10',
  };
  const signature =
    opts.signature === undefined ? updates.signGithubPayload(opts.signWith ?? SECRET, body) : opts.signature;
  if (signature !== null) headers['x-hub-signature-256'] = signature;
  const req = new Request(`${ORIGIN}/api/webhooks/github`, { method: 'POST', headers, body });
  return handleGithubWebhook(req, {
    deps,
    guildId,
    secret: 'secret' in opts ? opts.secret : SECRET,
  }).then(async (res) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> }));
}

const commit = (message: string, i = 1) => ({
  id: `${String(i).padStart(7, '0')}${'e'.repeat(33)}`,
  message,
  url: `https://github.com/gynx-gg/website/commit/${i}`,
  author: { name: 'Nick L', username: 'nick-dev' },
});

const pushPayload = (over: Record<string, unknown> = {}) => ({
  ref: 'refs/heads/main',
  deleted: false,
  compare: 'https://github.com/gynx-gg/website/compare/aaa...bbb',
  repository: { full_name: 'gynx-gg/website', default_branch: 'main' },
  pusher: { name: 'nick-dev' },
  commits: [commit('Internal: refactor sessions')],
  ...over,
});

const releasePayload = (over: Record<string, unknown> = {}) => ({
  action: 'published',
  repository: { full_name: 'gynx-gg/website', default_branch: 'main' },
  sender: { login: 'nick-dev' },
  release: {
    name: '2.0',
    tag_name: 'v2.0.0',
    body: 'Brand new look.',
    html_url: 'https://github.com/gynx-gg/website/releases/tag/v2.0.0',
    draft: false,
    prerelease: false,
    ...over,
  },
});

const text = (v: unknown) => JSON.stringify(v);

afterAll(async () => {
  await testDb().$disconnect();
});

describe('GitHub webhook endpoint', () => {
  it('answers 503 when no secret is configured', async () => {
    const { guildId, deps } = await setup();
    const r = await deliver(guildId, deps, 'push', pushPayload(), { secret: undefined });
    expect(r.status).toBe(503);
    expect(await testDb().updateFeedEvent.count({ where: { guildId } })).toBe(0);
  });

  it('rejects missing, wrong and wrong-secret signatures (401)', async () => {
    const { guildId, deps } = await setup();
    expect((await deliver(guildId, deps, 'push', pushPayload(), { signature: null })).status).toBe(401);
    expect((await deliver(guildId, deps, 'push', pushPayload(), { signature: 'sha256=abc' })).status).toBe(
      401,
    );
    expect(
      (await deliver(guildId, deps, 'push', pushPayload(), { signWith: 'some-other-secret-value' })).status,
    ).toBe(401);
    expect(await testDb().updateFeedEvent.count({ where: { guildId } })).toBe(0);
  });

  it('answers ping with 200', async () => {
    const { guildId, deps } = await setup();
    const r = await deliver(guildId, deps, 'ping', { zen: 'Design for failure.', hook_id: 1 });
    expect(r).toEqual({ status: 200, body: { ok: true } });
  });

  it('ignores unknown and disabled repositories (202)', async () => {
    const { guildId, deps, admin, repo } = await setup();
    const unknown = await deliver(guildId, deps, 'push', {
      ...pushPayload(),
      repository: { full_name: 'someone/else', default_branch: 'main' },
    });
    expect(unknown.status).toBe(202);
    expect(unknown.body.ignored).toBe(true);
    await updates.upsertRepo(admin, { ...repo, enabled: false });
    const disabled = await deliver(guildId, deps, 'push', pushPayload());
    expect(disabled.status).toBe(202);
    expect(await testDb().updateFeedEvent.count({ where: { guildId } })).toBe(0);
  });

  it('ignores other branches, tag pushes, deletions, empty pushes and unused events (202)', async () => {
    const { guildId, deps } = await setup();
    const cases = [
      pushPayload({ ref: 'refs/heads/feature/x' }),
      pushPayload({ ref: 'refs/tags/v1.0.0' }),
      pushPayload({ deleted: true, commits: [] }),
      pushPayload({ commits: [] }),
    ];
    for (const p of cases) {
      const r = await deliver(guildId, deps, 'push', p);
      expect(r.status, text(p.ref)).toBe(202);
      expect(r.body.reason).toBeTruthy();
    }
    expect((await deliver(guildId, deps, 'push', pushPayload({ ref: 'refs/tags/v1' }))).body.reason).toBe(
      'tag push',
    );
    expect((await deliver(guildId, deps, 'issues', { action: 'opened' })).status).toBe(202);
    expect((await deliver(guildId, deps, 'release', releasePayload({ draft: true }))).status).toBe(202);
    expect((await deliver(guildId, deps, 'release', { ...releasePayload(), action: 'created' })).status).toBe(
      202,
    );
    expect(await testDb().updateFeedEvent.count({ where: { guildId } })).toBe(0);
  });

  it('tracks a configured branch instead of the default branch', async () => {
    const { guildId, deps } = await setup({ branch: 'production' });
    expect((await deliver(guildId, deps, 'push', pushPayload())).status).toBe(202);
    expect((await deliver(guildId, deps, 'push', pushPayload({ ref: 'refs/heads/production' }))).status).toBe(
      200,
    );
  });

  it('rejects oversized bodies (413) and non-JSON content (415)', async () => {
    const { guildId, deps } = await setup();
    const big = await deliver(guildId, deps, 'push', pushPayload({ filler: 'x'.repeat(1024 * 1024 + 10) }));
    expect(big.status).toBe(413);
    const body = 'payload=%7B%7D';
    const req = new Request(`${ORIGIN}/api/webhooks/github`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-github-event': 'push',
        'x-github-delivery': randomUUID(),
        'x-hub-signature-256': updates.signGithubPayload(SECRET, body),
      },
      body,
    });
    expect((await handleGithubWebhook(req, { deps, guildId, secret: SECRET })).status).toBe(415);
  });

  it('rate limits per IP (429)', async () => {
    const { guildId, deps } = await setup();
    let last = 0;
    for (let i = 0; i < 125; i++) {
      last = (await deliver(guildId, deps, 'ping', {}, { signature: 'sha256=00' })).status;
    }
    expect(last).toBe(429);
  });
});

describe('update feed posting', () => {
  it('a valid push → stored event + job → staff post only (untagged)', async () => {
    const { guildId, deps, runner, staffPosts, publicPosts } = await setup();
    const token = fakeGithubToken();
    const r = await deliver(
      guildId,
      deps,
      'push',
      pushPayload({ commits: [commit(`Internal: rotate ${token}`), commit('Bump deps', 2)] }),
    );
    expect(r.status).toBe(200);
    expect(r.body.queued).toBe(true);

    const ev = await testDb().updateFeedEvent.findFirstOrThrow({ where: { guildId } });
    expect(ev).toMatchObject({ kind: 'push', ref: 'main', status: 'PENDING' });
    expect(text(ev.data)).not.toContain(token); // redacted before storage
    expect(await testDb().scheduledJob.count({ where: { dedupeKey: `updates.post:${ev.id}` } })).toBe(1);

    await drainJobs(runner);
    expect(staffPosts()).toHaveLength(1);
    const staff = text(staffPosts()[0]!.body);
    expect(staff).toContain('Website updated');
    expect(staff).toContain('Bump deps');
    expect(staff).toContain('nick-dev');
    expect(staff).not.toContain(token);
    expect(staff).toContain('[REDACTED]');
    expect(publicPosts()).toHaveLength(0);
    const done = await testDb().updateFeedEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(done.status).toBe('POSTED');
    expect(done.staffMessageId).toBeTruthy();
    expect(done.publicMessageId).toBeNull();
  });

  it('a tagged push is also posted publicly with only the tagged lines', async () => {
    const { guildId, deps, runner, staffPosts, publicPosts } = await setup();
    await deliver(
      guildId,
      deps,
      'push',
      pushPayload({
        commits: [
          commit('Internal: secret roadmap notes', 1),
          commit('Faster server start-up [public] (#12)', 2),
          commit('Merge pull request #13 from gynx-gg/backups\n\nOne-click backups [Public]', 3),
        ],
      }),
    );
    await drainJobs(runner);
    expect(staffPosts()).toHaveLength(1);
    expect(publicPosts()).toHaveLength(1);
    const pub = text(publicPosts()[0]!.body);
    expect(pub).toContain('Faster server start-up');
    expect(pub).toContain('One-click backups');
    expect(pub).not.toContain('secret roadmap');
    expect(pub).not.toContain('nick-dev');
    expect(pub).not.toContain('0000002');
    expect(pub).not.toContain('compare');
    expect(pub).not.toContain('gynx-gg/backups');
    expect(pub).not.toMatch(/\[public\]/i);
  });

  it('the public switch keeps everything in the staff channel', async () => {
    const { guildId, deps, runner, staffPosts, publicPosts } = await setup({ publicEnabled: false });
    await deliver(guildId, deps, 'push', pushPayload({ commits: [commit('New page [public]')] }));
    await deliver(guildId, deps, 'release', releasePayload());
    await drainJobs(runner);
    expect(staffPosts()).toHaveLength(2);
    expect(publicPosts()).toHaveLength(0);
  });

  it('a duplicate delivery is stored once and posted once', async () => {
    const { guildId, deps, runner, staffPosts, publicPosts } = await setup();
    const deliveryId = randomUUID();
    const payload = pushPayload({ commits: [commit('Dark mode [public]')] });
    expect((await deliver(guildId, deps, 'push', payload, { deliveryId })).status).toBe(200);
    await drainJobs(runner);
    const again = await deliver(guildId, deps, 'push', payload, { deliveryId });
    expect(again).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    await drainJobs(runner);
    expect(await testDb().updateFeedEvent.count({ where: { guildId } })).toBe(1);
    expect(staffPosts()).toHaveLength(1);
    expect(publicPosts()).toHaveLength(1);

    // Re-running the job (e.g. after a crash) never reposts.
    const ev = await testDb().updateFeedEvent.findFirstOrThrow({ where: { guildId } });
    await updates.postUpdateEvent(deps, ev.id);
    expect(staffPosts()).toHaveLength(1);
    expect(publicPosts()).toHaveLength(1);
  });

  it('a published release is posted publicly; a pre-release goes to staff only', async () => {
    const { guildId, deps, runner, staffPosts, publicPosts } = await setup();
    expect((await deliver(guildId, deps, 'release', releasePayload())).status).toBe(200);
    await drainJobs(runner);
    expect(staffPosts()).toHaveLength(1);
    expect(publicPosts()).toHaveLength(1);
    expect(text(publicPosts()[0]!.body)).toContain('Website 2.0 released');
    expect(text(publicPosts()[0]!.body)).toContain('Brand new look.');

    expect(
      (
        await deliver(
          guildId,
          deps,
          'release',
          releasePayload({ prerelease: true, tag_name: 'v2.1.0-beta', name: 'Beta' }),
        )
      ).status,
    ).toBe(200);
    await drainJobs(runner);
    expect(staffPosts()).toHaveLength(2);
    expect(text(staffPosts()[1]!.body)).toContain('new pre-release Beta');
    expect(publicPosts()).toHaveLength(1);
  });

  it('skips channels that are not set', async () => {
    const { guildId, deps, runner } = await setup({ channels: false });
    await deliver(guildId, deps, 'push', pushPayload({ commits: [commit('Dark mode [public]')] }));
    await drainJobs(runner);
    expect(deps.discord.sent).toHaveLength(0);
    const ev = await testDb().updateFeedEvent.findFirstOrThrow({ where: { guildId } });
    expect(ev.status).toBe('SKIPPED');

    // Only the staff channel set → staff post, public skipped.
    const staffOnly = snowflake();
    await testDb().guildConfig.update({ where: { guildId }, data: { updatesStaffChannelId: staffOnly } });
    await deliver(guildId, deps, 'push', pushPayload({ commits: [commit('Another [public]', 2)] }));
    await drainJobs(runner);
    expect(deps.discord.sent.map((m) => m.channelId)).toEqual([staffOnly]);
  });

  it('missing access marks the delivery NO_ACCESS without retrying forever', async () => {
    const { guildId, deps, runner, publicPosts } = await setup();
    deps.discord.failNextSend = new DiscordAPIError(
      { message: 'Missing Access', code: 50001 },
      50001,
      403,
      'POST',
      '',
      {},
    );
    await deliver(guildId, deps, 'push', pushPayload({ commits: [commit('Dark mode [public]')] }));
    await drainJobs(runner);
    const ev = await testDb().updateFeedEvent.findFirstOrThrow({ where: { guildId } });
    expect(ev.status).toBe('NO_ACCESS');
    expect(ev.staffMessageId).toBeNull();
    expect(publicPosts()).toHaveLength(1); // the other channel still gets its post
    const job = await testDb().scheduledJob.findFirstOrThrow({
      where: { dedupeKey: `updates.post:${ev.id}` },
    });
    expect(job.status).toBe('DONE');
  });

  it('a transient Discord error is retried without reposting the channel that succeeded', async () => {
    const { guildId, deps, staffPosts, publicPosts } = await setup();
    await deliver(guildId, deps, 'push', pushPayload({ commits: [commit('Dark mode [public]')] }));
    const ev = await testDb().updateFeedEvent.findFirstOrThrow({ where: { guildId } });
    let calls = 0;
    const realSend = deps.discord.sendMessage.bind(deps.discord);
    deps.discord.sendMessage = async (channelId, body) => {
      calls++;
      if (calls === 2) throw new DiscordAPIError({ message: 'oops', code: 0 }, 0, 500, 'POST', '', {});
      return realSend(channelId, body);
    };
    await expect(updates.postUpdateEvent(deps, ev.id)).rejects.toBeInstanceOf(DiscordAPIError);
    await updates.postUpdateEvent(deps, ev.id);
    expect(staffPosts()).toHaveLength(1);
    expect(publicPosts()).toHaveLength(1);
  });

  it('the module switch makes deliveries be ignored', async () => {
    const { guildId, deps } = await setup();
    const cfg = await testDb().guildConfig.findUniqueOrThrow({ where: { guildId } });
    expect(cfg.enabledModules).toContain('updates');
    await testDb().guildConfig.update({
      where: { guildId },
      data: { enabledModules: cfg.enabledModules.filter((m) => m !== 'updates') },
    });
    const r = await deliver(guildId, deps, 'push', pushPayload());
    expect(r.status).toBe(202);
  });
});

// ── Repo CRUD API ────────────────────────────────────────────────────────────

async function staffSession(guildId: string, permissions: string[]) {
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

type Def = { opts: Parameters<typeof executeApi>[0]; handler: Parameters<typeof executeApi>[1] };

async function api(
  def: Def,
  guildId: string,
  method: string,
  path: string,
  opts: {
    who?: { token: string; csrf: string };
    csrf?: boolean;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.who) headers.cookie = `gynx_session=${opts.who.token}`;
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    if (opts.csrf !== false && opts.who) headers['x-csrf-token'] = opts.who.csrf;
  }
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const rt = { deps: testDeps({ dashboardUrl: ORIGIN }), guildId, dashboardOrigin: ORIGIN };
  const res = await executeApi(def.opts, def.handler as never, req, opts.params ?? {}, rt);
  const t = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed JSON assertions in tests
  return { status: res.status, body: (t ? JSON.parse(t) : null) as Record<string, any> };
}

const validRepo = {
  fullName: 'gynx-gg/game-panel',
  displayName: 'Game panel',
  color: '#7c3aed',
  branch: '',
  enabled: true,
  publicEnabled: true,
};

describe('update feed dashboard API', () => {
  const ROUTES: Array<{
    name: string;
    def: Def;
    method: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
  }> = [
    { name: 'list repos', def: listReposRoute, method: 'GET', path: '/api/updates/repos' },
    {
      name: 'create repo',
      def: createRepoRoute,
      method: 'POST',
      path: '/api/updates/repos',
      body: validRepo,
    },
    {
      name: 'update repo',
      def: updateRepoRoute,
      method: 'PATCH',
      path: '/api/updates/repos/r1',
      body: validRepo,
      params: { id: 'r1' },
    },
    {
      name: 'delete repo',
      def: deleteRepoRoute,
      method: 'DELETE',
      path: '/api/updates/repos/r1',
      params: { id: 'r1' },
    },
    { name: 'events', def: listEventsRoute, method: 'GET', path: '/api/updates/events' },
  ];

  it('every route requires a session (401)', async () => {
    const guildId = await freshGuild();
    for (const r of ROUTES) {
      const res = await api(r.def, guildId, r.method, r.path, { body: r.body, params: r.params });
      expect(res.status, r.name).toBe(401);
    }
  });

  it('every route requires updates.manage (403) and audits the denial', async () => {
    const guildId = await freshGuild();
    const plain = await staffSession(guildId, ['settings.manage', 'support.duty.manage']);
    for (const r of ROUTES) {
      const res = await api(r.def, guildId, r.method, r.path, { who: plain, body: r.body, params: r.params });
      expect(res.status, r.name).toBe(403);
      expect(res.body.error.code, r.name).toBe('FORBIDDEN');
    }
    const denials = await testDb().securityAuditEvent.findMany({
      where: { guildId, actorId: plain.userId, action: 'dashboard.permission.denied', result: 'DENIED' },
    });
    expect(denials).toHaveLength(ROUTES.length);
    for (const d of denials) expect((d.metadata as { required?: string }).required).toBe('updates.manage');
  });

  it('mutations require the CSRF token', async () => {
    const guildId = await freshGuild();
    const admin = await staffSession(guildId, ['updates.manage']);
    for (const r of ROUTES.filter((x) => x.method !== 'GET')) {
      const res = await api(r.def, guildId, r.method, r.path, {
        who: admin,
        csrf: false,
        body: r.body,
        params: r.params,
      });
      expect(res.status, r.name).toBe(403);
      expect(res.body.error.code, r.name).toBe('CSRF');
    }
    expect(await testDb().updateFeedRepo.count({ where: { guildId } })).toBe(0);
  });

  it('validates repository fields (400 with field issues)', async () => {
    const guildId = await freshGuild();
    const admin = await staffSession(guildId, ['updates.manage']);
    const bad = await api(createRepoRoute, guildId, 'POST', '/api/updates/repos', {
      who: admin,
      body: { fullName: 'not a repo', displayName: '', color: 'purple', branch: 'bad..branch' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
    const paths = (bad.body.error.issues as Array<{ path: string }>).map((i) => i.path).sort();
    expect(paths).toEqual(['branch', 'color', 'displayName', 'fullName']);
    const mention = await api(createRepoRoute, guildId, 'POST', '/api/updates/repos', {
      who: admin,
      body: { ...validRepo, displayName: '@everyone' },
    });
    expect(mention.status).toBe(400);
  });

  it('creates, lists, edits and deletes repositories, with audit entries', async () => {
    const guildId = await freshGuild();
    const admin = await staffSession(guildId, ['updates.manage']);
    const created = await api(createRepoRoute, guildId, 'POST', '/api/updates/repos', {
      who: admin,
      body: { ...validRepo, fullName: 'GYNX-GG/Game-Panel' },
    });
    expect(created.status).toBe(200);
    expect(created.body.repo).toMatchObject({
      fullName: 'gynx-gg/game-panel',
      displayName: 'Game panel',
      color: '#7C3AED',
      branch: null,
    });
    const id = created.body.repo.id as string;

    const dup = await api(createRepoRoute, guildId, 'POST', '/api/updates/repos', {
      who: admin,
      body: validRepo,
    });
    expect(dup.status).toBe(409);

    const list = await api(listReposRoute, guildId, 'GET', '/api/updates/repos', { who: admin });
    expect(list.body.repos).toHaveLength(1);

    const edited = await api(updateRepoRoute, guildId, 'PATCH', `/api/updates/repos/${id}`, {
      who: admin,
      body: { ...validRepo, branch: 'release', publicEnabled: false },
      params: { id },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.repo).toMatchObject({ id, branch: 'release', publicEnabled: false });

    // Another guild's admin can't touch it.
    const otherGuild = await freshGuild();
    const other = await staffSession(otherGuild, ['updates.manage']);
    const foreign = await api(deleteRepoRoute, otherGuild, 'DELETE', `/api/updates/repos/${id}`, {
      who: other,
      params: { id },
    });
    expect(foreign.status).toBe(404);

    const removed = await api(deleteRepoRoute, guildId, 'DELETE', `/api/updates/repos/${id}`, {
      who: admin,
      params: { id },
    });
    expect(removed.status).toBe(200);
    expect(await testDb().updateFeedRepo.count({ where: { guildId } })).toBe(0);

    const actions = (
      await testDb().securityAuditEvent.findMany({
        where: { guildId, actorId: admin.userId, result: 'SUCCESS' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['updates.repo.create', 'updates.repo.update', 'updates.repo.delete']);

    const events = await api(listEventsRoute, guildId, 'GET', '/api/updates/events', { who: admin });
    expect(events.status).toBe(200);
    expect(events.body.events).toEqual([]);
  });
});
