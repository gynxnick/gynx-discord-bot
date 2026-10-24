import { afterAll, describe, expect, it } from 'vitest';
import * as ann from '../../apps/dashboard/src/app/api/marketing/_lib/announcements';
import * as events from '../../apps/dashboard/src/app/api/engagement/_lib/events';
import * as giveaways from '../../apps/dashboard/src/app/api/engagement/_lib/giveaways';
import * as polls from '../../apps/dashboard/src/app/api/engagement/_lib/polls';
import * as links from '../../apps/dashboard/src/app/api/marketing/_lib/links';
import * as partners from '../../apps/dashboard/src/app/api/marketing/_lib/partners';
import * as refs from '../../apps/dashboard/src/app/api/marketing/_lib/referrals';
import type { RouteDef } from '../../apps/dashboard/src/app/api/community/_lib/route-def';
import { executeApi, type ApiRuntime } from '../../apps/dashboard/src/server/api-core';
import { createSession } from '../../apps/dashboard/src/server/session-store';
import { fakeDiscord, freshGuild, snowflake, testDb, testDeps, type FakeDiscord } from './helpers';

const ORIGIN = 'https://dash.test';

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

describe('dashboard marketing API', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('rejects unauthenticated requests (401) and missing permissions (403)', async () => {
    const guildId = await freshGuild();
    const r = rt(guildId);
    expect((await call(ann.listAnnouncements, r)).status).toBe(401);
    const s = await newSession(guildId, ['events.manage']);
    const res = await call(ann.createAnnouncement, r, {
      session: s,
      body: { title: 'Hi', body: 'There', channelId: snowflake() },
    });
    expect(res.status).toBe(403);
    expect((await json<ErrBody>(res)).error.code).toBe('FORBIDDEN');
    expect(await testDb().announcement.count({ where: { guildId } })).toBe(0);
  });

  it('requires the CSRF token for mutations (403)', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['announcements.create']);
    const res = await call(ann.createAnnouncement, rt(guildId), {
      session: s,
      csrf: false,
      body: { title: 'Hi', body: 'There', channelId: snowflake() },
    });
    expect(res.status).toBe(403);
    expect((await json<ErrBody>(res)).error.code).toBe('CSRF');
    expect(await testDb().announcement.count({ where: { guildId } })).toBe(0);
  });

  it('creates a draft, edits it with expectedVersion and publishes it', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['announcements.create', 'announcements.publish']);
    const r = rt(guildId);
    const created = await call(ann.createAnnouncement, r, {
      session: s,
      body: {
        type: 'FEATURE_RELEASE',
        title: 'New: backups',
        body: 'Daily **backups** are live.',
        channelId: snowflake(),
      },
    });
    expect(created.status).toBe(200);
    const a = await json<{ id: string; status: string; version: number }>(created);
    expect(a).toMatchObject({ status: 'DRAFT', version: 1 });

    const stale = await call(ann.updateAnnouncement, r, {
      session: s,
      method: 'PATCH',
      params: { id: a.id },
      body: { title: 'x', expectedVersion: 99 },
    });
    expect(stale.status).toBe(409);
    const edited = await call(ann.updateAnnouncement, r, {
      session: s,
      method: 'PATCH',
      params: { id: a.id },
      body: { title: 'New: daily backups', expectedVersion: 1 },
    });
    expect(edited.status).toBe(200);

    const preview = await json<{ version: number; warning: string | null }>(
      await call(ann.previewAnnouncement, r, { session: s, params: { id: a.id } }),
    );
    expect(preview).toMatchObject({ version: 2, warning: null });
    const stalePub = await call(ann.publishAnnouncement, r, {
      session: s,
      params: { id: a.id },
      body: { expectedVersion: 1 },
    });
    expect(stalePub.status).toBe(409);
    const pub = await call(ann.publishAnnouncement, r, {
      session: s,
      params: { id: a.id },
      body: { expectedVersion: preview.version },
    });
    expect(pub.status).toBe(200);
    expect(await json(pub)).toMatchObject({ status: 'SCHEDULED', version: 3 });
    expect(
      await testDb().scheduledJob.count({ where: { guildId, type: 'marketing.announcement.publish' } }),
    ).toBe(1);
  });

  it('refuses a mass-mention publish without announcements.mass_mention (403)', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['announcements.create', 'announcements.publish']);
    const r = rt(guildId);
    const a = await json<{ id: string; version: number }>(
      await call(ann.createAnnouncement, r, {
        session: s,
        body: { title: 'Big news', body: 'Everyone look!', channelId: snowflake(), mention: 'EVERYONE' },
      }),
    );
    const res = await call(ann.publishAnnouncement, r, {
      session: s,
      params: { id: a.id },
      body: { expectedVersion: a.version, confirmMentions: true },
    });
    expect(res.status).toBe(403);
    expect((await json<ErrBody>(res)).error.message).toMatch(/mass-mention permission/);
    expect((await testDb().announcement.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('DRAFT');
    expect(
      await testDb().securityAuditEvent.count({
        where: { guildId, action: 'announcements.mass_mention', result: 'DENIED' },
      }),
    ).toBe(1);

    // With the permission, an unconfirmed ping is still rejected; a confirmed one is queued.
    const mm = await newSession(guildId, [
      'announcements.create',
      'announcements.publish',
      'announcements.mass_mention',
    ]);
    expect(
      (
        await call(ann.publishAnnouncement, r, {
          session: mm,
          params: { id: a.id },
          body: { expectedVersion: a.version },
        })
      ).status,
    ).toBe(400);
    const ok = await call(ann.publishAnnouncement, r, {
      session: mm,
      params: { id: a.id },
      body: { expectedVersion: a.version, confirmMentions: true },
    });
    expect(ok.status).toBe(200);
  });

  it('creates a tracked link and toggles it', async () => {
    const guildId = await freshGuild();
    const s = await newSession(guildId, ['announcements.create']);
    const r = rt(guildId);
    const bad = await call(links.createTrackedLink, r, {
      session: s,
      body: { targetUrl: 'https://127.0.0.1/x' },
    });
    expect(bad.status).toBe(400);
    const res = await call(links.createTrackedLink, r, {
      session: s,
      body: { targetUrl: 'https://gynx.gg/pricing', campaign: 'spring' },
    });
    expect(res.status).toBe(200);
    const link = await json<{ id: string; slug: string }>(res);
    expect(link.slug).toMatch(/^[0-9A-Za-z]{8}$/);
    const off = await call(links.setTrackedLinkActive, r, {
      session: s,
      method: 'PATCH',
      params: { id: link.id },
      body: { active: false },
    });
    expect(off.status).toBe(200);
    expect((await testDb().trackedLink.findUniqueOrThrow({ where: { id: link.id } })).active).toBe(false);
  });

  it('reviews a flagged referral attribution (referrals.manage only)', async () => {
    const guildId = await freshGuild();
    const db = testDb();
    const row = await db.referralAttribution.create({
      data: {
        guildId,
        joinedUserId: snowflake(),
        inviteCode: 'abc',
        referrerId: snowflake(),
        confidence: 'CONFIRMED',
        status: 'FLAGGED',
        flagReason: 'burst',
      },
    });
    const r = rt(guildId);
    const viewer = await newSession(guildId, ['referrals.view']);
    expect(
      (
        await call(refs.reviewAttribution, r, {
          session: viewer,
          params: { id: row.id },
          body: { status: 'VALID', note: 'checked' },
        })
      ).status,
    ).toBe(403);
    const mgr = await newSession(guildId, ['referrals.manage']);
    const ok = await call(refs.reviewAttribution, r, {
      session: mgr,
      params: { id: row.id },
      body: { status: 'INVALID', note: 'alt accounts' },
    });
    expect(ok.status).toBe(200);
    expect(await db.referralAttribution.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'INVALID',
      reviewNote: 'alt accounts',
    });
  });

  it('decides a partner application and gates canAnnounce behind settings.manage', async () => {
    const guildId = await freshGuild();
    const db = testDb();
    const app = await db.partnerApplication.create({
      data: {
        guildId,
        number: 1,
        ref: 'P-0001',
        applicantId: snowflake(),
        category: 'OTHER',
        answers: { about: 'We stream', proposal: 'Co-host events' },
      },
    });
    const r = rt(guildId);
    const reviewer = await newSession(guildId, ['partners.review']);
    const decided = await call(partners.decidePartnerApplication, r, {
      session: reviewer,
      params: { id: app.id },
      body: { decision: 'APPROVED', decisionNote: 'Welcome aboard', campaignName: 'Stream collab' },
    });
    expect(decided.status).toBe(200);
    const { campaign } = await json<{ campaign: { id: string; canAnnounce: boolean } }>(decided);
    expect(campaign.canAnnounce).toBe(false);

    const denied = await call(partners.updatePartnerCampaign, r, {
      session: reviewer,
      method: 'PATCH',
      params: { id: campaign.id },
      body: { canAnnounce: true },
    });
    expect(denied.status).toBe(403);
    const admin = await newSession(guildId, ['partners.review', 'settings.manage']);
    const allowed = await call(partners.updatePartnerCampaign, r, {
      session: admin,
      method: 'PATCH',
      params: { id: campaign.id },
      body: { canAnnounce: true },
    });
    expect(allowed.status).toBe(200);
    expect((await db.partnerCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).canAnnounce).toBe(
      true,
    );
  });

  it('creates an event from guild wall-clock times (events.manage)', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { timezone: 'Europe/London' } });
    const r = rt(guildId);
    const noPerm = await newSession(guildId, ['polls.manage']);
    expect((await call(events.createEvent, r, { session: noPerm, body: {} })).status).toBe(403);
    const s = await newSession(guildId, ['events.manage']);
    const y = new Date().getUTCFullYear() + 1;
    const badEnd = await call(events.createEvent, r, {
      session: s,
      body: {
        title: 'Game night',
        description: 'Bring friends',
        start: `${y}-07-01T19:00`,
        end: `${y}-07-01T18:00`,
        channelId: snowflake(),
      },
    });
    expect(badEnd.status).toBe(400);
    expect((await json<ErrBody>(badEnd)).error.issues?.[0]?.path).toBe('end');
    const ok = await call(events.createEvent, r, {
      session: s,
      body: {
        title: 'Game night',
        description: 'Bring friends',
        start: `${y}-07-01T19:00`,
        end: `${y}-07-01T21:00`,
        capacity: 20,
        channelId: snowflake(),
      },
    });
    expect(ok.status).toBe(200);
    const ev = await json<{ id: string; startsAt: string; endsAt: string }>(ok);
    // 19:00 BST = 18:00 UTC
    expect(ev.startsAt).toBe(`${y}-07-01T18:00:00.000Z`);
    expect(ev.endsAt).toBe(`${y}-07-01T20:00:00.000Z`);
  });

  it('creates a poll and a giveaway, and requires a reason to reroll', async () => {
    const guildId = await freshGuild();
    const r = rt(guildId);
    const s = await newSession(guildId, ['polls.manage', 'giveaways.manage']);
    const poll = await call(polls.createPoll, r, {
      session: s,
      body: {
        question: 'Which game next?',
        options: ['Rust', 'Valheim'],
        durationMs: 3_600_000,
        channelId: snowflake(),
      },
    });
    expect(poll.status).toBe(200);
    const g = await testDb().giveaway.create({
      data: {
        guildId,
        prize: 'Nitro',
        endsAt: new Date(),
        status: 'ENDED',
        createdById: snowflake(),
        channelId: snowflake(),
      },
    });
    const noReason = await call(giveaways.rerollGiveaway, r, {
      session: s,
      params: { id: g.id },
      body: { reason: '' },
    });
    expect(noReason.status).toBe(400);
    // 60 days from now, as a local "YYYY-MM-DDTHH:MM" (always beyond the 30-day limit).
    const tooFar = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 16);
    const created = await call(giveaways.createGiveaway, r, {
      session: s,
      body: { prize: 'Server credit', winnerCount: 1, endsAt: tooFar, channelId: snowflake() },
    });
    // More than 30 days ahead is rejected on endsAt.
    expect(created.status).toBe(400);
    expect((await json<ErrBody>(created)).error.issues?.[0]?.path).toBe('endsAt');
  });
});
