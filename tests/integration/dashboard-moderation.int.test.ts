import { afterAll, describe, expect, it } from 'vitest';
import { makeCtx, moderation, systemActor } from '@gynx/services';
import {
  listAutomodEventsRoute,
  listWarningsRoute,
  reviewAppealRoute,
  reviewAutomodEventRoute,
  revokeWarningRoute,
  searchRecordsRoute,
  setNoteRoute,
  updateAutomodConfigRoute,
} from '../../apps/dashboard/src/app/api/moderation/handlers';
import { executeApi, type ApiRuntime } from '../../apps/dashboard/src/server/api-core';
import { createSession } from '../../apps/dashboard/src/server/session-store';
import { ctxAs, freshGuild, snowflake, testDb, testDeps } from './helpers';

const ORIGIN = 'https://dash.test';
const OWNER = '100000000000000000';
const subject: moderation.HierarchySubject = {
  actorHighest: 10,
  targetHighest: 1,
  botHighest: 20,
  guildOwnerId: OWNER,
  targetRoleIds: [],
};

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
    query?: string;
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
  const req = new Request(`${ORIGIN}/api/moderation/x${opts.query ? `?${opts.query}` : ''}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await executeApi(def.opts, def.handler, req, opts.params ?? {}, runtime(guildId));
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed JSON assertions in tests
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}

async function warn(guildId: string, targetId: string, note?: string) {
  const mod = ctxAs(guildId, ['moderation.execute']);
  const plan = await moderation.prepareAction(
    mod,
    { type: 'WARN', targetId, reason: 'Posting spam links', moderatorNote: note },
    subject,
  );
  return moderation.recordAction(mod, plan, { applied: true, dmSent: false });
}

describe('dashboard moderation API', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('401/403 gates; notes are hidden without moderation.audit.view', async () => {
    const guildId = await freshGuild();
    const target = snowflake();
    await warn(guildId, target, 'repeat offender');

    expect((await call(searchRecordsRoute, guildId)).status).toBe(401);
    const plain = await staff(guildId, []);
    expect((await call(searchRecordsRoute, guildId, { who: plain })).status).toBe(403);

    const executor = await staff(guildId, ['moderation.execute']);
    const asExec = await call(searchRecordsRoute, guildId, { who: executor, query: `targetId=${target}` });
    expect(asExec.status).toBe(200);
    expect(asExec.body.items).toHaveLength(1);
    expect(asExec.body.items[0].moderatorNote).toBeNull();

    const auditor = await staff(guildId, ['moderation.audit.view']);
    const asAudit = await call(searchRecordsRoute, guildId, { who: auditor, query: 'type=WARN' });
    expect(asAudit.body.items[0].moderatorNote).toBe('repeat offender');

    const bad = await call(searchRecordsRoute, guildId, { who: auditor, query: 'targetId=nope' });
    expect(bad.status).toBe(400);
  });

  it('edits moderator notes (audit.view only, CSRF required, audited)', async () => {
    const guildId = await freshGuild();
    const { action } = await warn(guildId, snowflake());
    const executor = await staff(guildId, ['moderation.execute']);
    expect(
      (
        await call(setNoteRoute, guildId, {
          method: 'PUT',
          who: executor,
          body: { note: 'x' },
          params: { id: action.id },
        })
      ).status,
    ).toBe(403);

    const auditor = await staff(guildId, ['moderation.audit.view']);
    const noCsrf = await call(setNoteRoute, guildId, {
      method: 'PUT',
      who: auditor,
      body: { note: 'x' },
      params: { id: action.id },
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF');

    const ok = await call(setNoteRoute, guildId, {
      method: 'PUT',
      who: auditor,
      body: { note: 'Context: raid wave' },
      params: { id: action.id },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.moderatorNote).toBe('Context: raid wave');
    expect(
      await testDb().securityAuditEvent.count({
        where: { guildId, action: 'moderation.note', actorId: auditor.userId },
      }),
    ).toBe(1);
  });

  it('lists and revokes warnings', async () => {
    const guildId = await freshGuild();
    const target = snowflake();
    await warn(guildId, target);
    const auditor = await staff(guildId, ['moderation.audit.view']);
    const list = await call(listWarningsRoute, guildId, { who: auditor, query: `userId=${target}` });
    expect(list.status).toBe(200);
    expect(list.body.activeCount).toBe(1);
    const warningId = list.body.warnings[0].id as string;

    expect(
      (
        await call(revokeWarningRoute, guildId, {
          method: 'POST',
          who: auditor,
          body: { reason: 'mistake' },
          params: { id: warningId },
        })
      ).status,
    ).toBe(403);
    const mod = await staff(guildId, ['moderation.execute']);
    expect(
      (
        await call(revokeWarningRoute, guildId, {
          method: 'POST',
          who: mod,
          body: { reason: 'x' },
          params: { id: warningId },
        })
      ).status,
    ).toBe(400);
    const ok = await call(revokeWarningRoute, guildId, {
      method: 'POST',
      who: mod,
      body: { reason: 'Issued by mistake' },
      params: { id: warningId },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.active).toBe(false);
    const after = await call(listWarningsRoute, guildId, {
      who: auditor,
      query: `userId=${target}&includeInactive=true`,
    });
    expect(after.body.activeCount).toBe(0);
    expect(after.body.all).toHaveLength(1);
  });

  it('updates automod config (automod.manage) and reviews events', async () => {
    const guildId = await freshGuild();
    const auditor = await staff(guildId, ['moderation.audit.view']);
    expect(
      (
        await call(updateAutomodConfigRoute, guildId, {
          method: 'PATCH',
          who: auditor,
          body: { maxMentions: 10 },
        })
      ).status,
    ).toBe(403);

    const manager = await staff(guildId, ['automod.manage']);
    const bad = await call(updateAutomodConfigRoute, guildId, {
      method: 'PATCH',
      who: manager,
      body: { warnAtStrikes: 5, timeoutAtStrikes: 3 },
    });
    expect(bad.status).toBe(400);
    const ok = await call(updateAutomodConfigRoute, guildId, {
      method: 'PATCH',
      who: manager,
      body: { maxMentions: 10, blockedDomains: ['https://Evil.example/path'] },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ maxMentions: 10, blockedDomains: ['evil.example'] });

    const sys = makeCtx(testDeps(), guildId, systemActor('bot'), 'test');
    const { event } = await moderation.recordAutomodHit(sys, {
      userId: snowflake(),
      channelId: snowflake(),
      rule: 'BURST',
      content: 'spam spam',
    });
    const events = await call(listAutomodEventsRoute, guildId, { who: auditor, query: 'unreviewed=true' });
    expect(events.status).toBe(200);
    expect(events.body.items.map((e: { id: string }) => e.id)).toEqual([event.id]);

    expect(
      (
        await call(reviewAutomodEventRoute, guildId, {
          method: 'POST',
          who: auditor,
          body: { falsePositive: true },
          params: { id: event.id },
        })
      ).status,
    ).toBe(403);
    const reviewed = await call(reviewAutomodEventRoute, guildId, {
      method: 'POST',
      who: manager,
      body: { falsePositive: true },
      params: { id: event.id },
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.falsePositive).toBe(true);
    expect(
      (await call(listAutomodEventsRoute, guildId, { who: auditor, query: 'unreviewed=true' })).body.items,
    ).toHaveLength(0);
  });

  it('reviews appeals: ban appeals need moderation.ban, timeouts flag manual reversal', async () => {
    const guildId = await freshGuild();
    const target = snowflake();
    const mod = ctxAs(guildId, ['moderation.execute', 'moderation.ban']);
    const timeout = await moderation.recordAction(
      mod,
      await moderation.prepareAction(
        mod,
        { type: 'TIMEOUT', targetId: target, reason: 'spam', duration: '1h' },
        subject,
      ),
      {
        applied: true,
        dmSent: false,
      },
    );
    const member = ctxAs(guildId, [], { userId: target });
    const appeal = await moderation.submitAppeal(member, {
      actionRef: timeout.action.ref,
      statement: 'I was not spamming, my client glitched and resent.',
    });

    const executor = await staff(guildId, ['moderation.execute']);
    const res = await call(reviewAppealRoute, guildId, {
      method: 'POST',
      who: executor,
      body: { decision: 'ACCEPTED', note: 'Sorry about that' },
      params: { id: appeal.id },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requiresManualReversal: true, appeal: { status: 'ACCEPTED' } });
    const again = await call(reviewAppealRoute, guildId, {
      method: 'POST',
      who: executor,
      body: { decision: 'DENIED' },
      params: { id: appeal.id },
    });
    expect(again.status).toBe(409);

    // A ban appeal (accepted by the service from a non-Discord flow) needs moderation.ban.
    const ban = await moderation.recordAction(
      mod,
      await moderation.prepareAction(mod, { type: 'BAN', targetId: target, reason: 'raid' }, subject),
      { applied: true, dmSent: false },
    );
    const banAppeal = await moderation.submitAppeal(ctxAs(guildId, [], { userId: target }), {
      actionRef: ban.action.ref,
      statement: 'Please reconsider, it was my brother on my account.',
    });
    expect(
      (
        await call(reviewAppealRoute, guildId, {
          method: 'POST',
          who: executor,
          body: { decision: 'DENIED' },
          params: { id: banAppeal.id },
        })
      ).status,
    ).toBe(403);
    const banner = await staff(guildId, ['moderation.ban']);
    expect(
      (
        await call(reviewAppealRoute, guildId, {
          method: 'POST',
          who: banner,
          body: { decision: 'DENIED' },
          params: { id: banAppeal.id },
        })
      ).status,
    ).toBe(200);
  });
});
