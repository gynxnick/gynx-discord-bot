import { afterAll, describe, expect, it } from 'vitest';
import { makeCtx, moderation, systemActor } from '@gynx/services';
import { ctxAs, freshGuild, snowflake, testDb, testDeps } from './helpers';

const OWNER = '100000000000000000';
const subject = (over: Partial<moderation.HierarchySubject> = {}): moderation.HierarchySubject => ({
  actorHighest: 10,
  targetHighest: 1,
  botHighest: 20,
  guildOwnerId: OWNER,
  targetRoleIds: [],
  ...over,
});

describe('moderation: prepare / record', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('denies members without permission and audits the denial', async () => {
    const guildId = await freshGuild();
    const member = ctxAs(guildId);
    await expect(
      moderation.prepareAction(member, { type: 'WARN', targetId: snowflake(), reason: 'spamming' }, subject()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const denied = await testDb().securityAuditEvent.findFirst({ where: { guildId, action: 'moderation.warn', result: 'DENIED' } });
    expect(denied).not.toBeNull();

    // moderation.execute is not enough for a ban
    const mod = ctxAs(guildId, ['moderation.execute']);
    await expect(moderation.prepareAction(mod, { type: 'BAN', targetId: snowflake(), reason: 'raiding' }, subject())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('validates reason and durations', async () => {
    const guildId = await freshGuild();
    const mod = ctxAs(guildId, ['moderation.execute', 'moderation.ban']);
    const t = snowflake();
    await expect(moderation.prepareAction(mod, { type: 'WARN', targetId: t, reason: 'x' }, subject())).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(moderation.prepareAction(mod, { type: 'TIMEOUT', targetId: t, reason: 'spam' }, subject())).rejects.toThrow(/duration is required/);
    await expect(moderation.prepareAction(mod, { type: 'TIMEOUT', targetId: t, reason: 'spam', duration: '30d' }, subject())).rejects.toThrow(/28 days/);
    await expect(moderation.prepareAction(mod, { type: 'BAN', targetId: t, reason: 'spam', duration: '400d' }, subject())).rejects.toThrow(/365 days/);
    await expect(moderation.prepareAction(mod, { type: 'KICK', targetId: t, reason: 'spam', deleteMessageDays: 3 }, subject())).rejects.toThrow(/only applies to bans/);
    const plan = await moderation.prepareAction(mod, { type: 'TIMEOUT', targetId: t, reason: 'spam', duration: '1h30m' }, subject());
    expect(plan.durationMs).toBe(90 * 60_000);
  });

  it('enforces hierarchy and protects staff, auditing denials', async () => {
    const guildId = await freshGuild();
    const staffRole = snowflake();
    await testDb().staffPermission.create({
      data: { guildId, subjectType: 'ROLE', subjectId: staffRole, permission: 'moderation.execute', effect: 'ALLOW', createdById: OWNER },
    });
    const mod = ctxAs(guildId, ['moderation.execute']);
    const target = snowflake();
    await expect(moderation.prepareAction(mod, { type: 'WARN', targetId: mod.actor.userId, reason: 'self' }, subject())).rejects.toThrow(/yourself/);
    await expect(moderation.prepareAction(mod, { type: 'KICK', targetId: target, reason: 'abuse' }, subject({ targetHighest: 10 }))).rejects.toThrow(/equal or higher/);
    await expect(moderation.prepareAction(mod, { type: 'KICK', targetId: OWNER, reason: 'abuse' }, subject())).rejects.toThrow(/owner/);
    await expect(
      moderation.prepareAction(mod, { type: 'KICK', targetId: target, reason: 'abuse' }, subject({ targetRoleIds: [staffRole] })),
    ).rejects.toThrow(/staff/);
    const senior = ctxAs(guildId, ['moderation.execute', 'moderation.ban']);
    await expect(
      moderation.prepareAction(senior, { type: 'KICK', targetId: target, reason: 'abuse' }, subject({ targetRoleIds: [staffRole] })),
    ).resolves.toMatchObject({ type: 'KICK' });
    const denials = await testDb().securityAuditEvent.count({ where: { guildId, result: 'DENIED', metadata: { path: ['reason'], equals: 'hierarchy' } } });
    expect(denials).toBe(4);
  });

  it('WARN creates a Warning, a ref, an audit event, a modlog job and an escalation suggestion', async () => {
    const guildId = await freshGuild();
    const mod = ctxAs(guildId, ['moderation.execute', 'moderation.audit.view']);
    const target = snowflake();
    const plan = await moderation.prepareAction(mod, { type: 'WARN', targetId: target, reason: 'Posting spam', moderatorNote: 'repeat offender' }, subject());
    const r1 = await moderation.recordAction(mod, plan, { applied: true, dmSent: true });
    expect(r1.action.ref).toBe('M-0001');
    expect(r1.activeWarnings).toBe(1);
    expect(r1.suggestion?.action).toBe('WARN');
    const r2 = await moderation.recordAction(mod, await moderation.prepareAction(mod, { type: 'WARN', targetId: target, reason: 'Again' }, subject()), { applied: true, dmSent: false });
    expect(r2.action.ref).toBe('M-0002');
    expect(r2.suggestion?.action).toBe('TIMEOUT');

    const warning = await testDb().warning.findUnique({ where: { actionId: r1.action.id } });
    expect(warning?.active).toBe(true);
    expect(warning?.expiresAt).not.toBeNull();
    const job = await testDb().scheduledJob.findUnique({ where: { dedupeKey: `moderation.modlog:${r1.action.id}` } });
    expect(job?.status).toBe('PENDING');
    const auditRow = await testDb().securityAuditEvent.findFirst({ where: { guildId, action: 'moderation.warn', result: 'SUCCESS' } });
    expect(auditRow).not.toBeNull();

    // Notes are restricted to moderation.audit.view
    const exec = ctxAs(guildId, ['moderation.execute']);
    const asExec = await moderation.searchActions(exec, { targetId: target });
    expect(asExec.items).toHaveLength(2);
    expect(asExec.items.every((a) => a.moderatorNote === null)).toBe(true);
    const asAuditor = await moderation.getAction(mod, r1.action.ref);
    expect(asAuditor.moderatorNote).toBe('repeat offender');

    // Summary + revoke
    const summary = await moderation.getWarningSummary(mod, target);
    expect(summary.activeCount).toBe(2);
    await moderation.revokeWarning(exec, warning!.id, 'Issued in error');
    expect((await moderation.getWarningSummary(mod, target)).activeCount).toBe(1);
    await expect(moderation.revokeWarning(exec, warning!.id, 'again')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(moderation.listWarnings(exec, target)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('records failed Discord actions as FAILED without side effects', async () => {
    const guildId = await freshGuild();
    const mod = ctxAs(guildId, ['moderation.execute']);
    const plan = await moderation.prepareAction(mod, { type: 'TIMEOUT', targetId: snowflake(), reason: 'spam', duration: '10m' }, subject());
    const r = await moderation.recordAction(mod, plan, { applied: false, error: 'Missing Permissions', dmSent: false });
    expect(r.action.status).toBe('FAILED');
    expect(r.action.failureReason).toBe('Missing Permissions');
    expect(await testDb().scheduledJob.findUnique({ where: { dedupeKey: `moderation.expire:${r.action.id}` } })).toBeNull();
    expect(await testDb().securityAuditEvent.findFirst({ where: { guildId, action: 'moderation.timeout', result: 'FAILURE' } })).not.toBeNull();
  });

  it('temp ban schedules an expiry job; unban reverses it and cancels the job', async () => {
    const guildId = await freshGuild();
    const mod = ctxAs(guildId, ['moderation.execute', 'moderation.ban']);
    const target = snowflake();
    const ban = await moderation.recordAction(
      mod,
      await moderation.prepareAction(mod, { type: 'BAN', targetId: target, reason: 'raid', duration: '7d', deleteMessageDays: 1 }, subject()),
      { applied: true, dmSent: true },
    );
    const job = await testDb().scheduledJob.findUnique({ where: { dedupeKey: `moderation.expire:${ban.action.id}` } });
    expect(job?.status).toBe('PENDING');
    await moderation.recordAction(mod, await moderation.prepareAction(mod, { type: 'UNBAN', targetId: target, reason: 'appeal accepted' }), { applied: true, dmSent: false });
    expect((await testDb().moderationAction.findUnique({ where: { id: ban.action.id } }))?.status).toBe('REVERSED');
    expect((await testDb().scheduledJob.findUnique({ where: { dedupeKey: `moderation.expire:${ban.action.id}` } }))?.status).toBe('CANCELLED');
  });
});

describe('moderation: automod escalation', () => {
  it('escalates delete → warn → timeout by strikes and never bans', async () => {
    const guildId = await freshGuild();
    const deps = testDeps();
    const sys = makeCtx(deps, guildId, systemActor('bot'), 'test');
    const userId = snowflake();
    const channelId = snowflake();
    const decisions: string[] = [];
    for (let i = 0; i < 8; i++) {
      const { event, decision } = await moderation.recordAutomodHit(sys, {
        userId,
        channelId,
        rule: 'PHISHING',
        content: `free nitro https://dlscord.gift/x token=supersecretvalue123 @everyone ${'x'.repeat(300)}`,
      });
      decisions.push(decision.action);
      expect(event.excerpt!.length).toBeLessThanOrEqual(200);
      expect(event.excerpt).not.toContain('supersecretvalue123');
      expect(event.excerpt).not.toContain('https://');
      expect(event.excerpt).not.toMatch(/@everyone/);

      if (decision.action === 'WARN' || decision.action === 'TIMEOUT') {
        const plan = await moderation.prepareAction(
          sys,
          {
            type: decision.action,
            targetId: userId,
            reason: 'Automod: suspected phishing link',
            duration: decision.durationMs ? `${decision.durationMs / 60_000}m` : undefined,
            automodEventId: event.id,
          },
          subject({ actorHighest: 20 }),
        );
        expect(plan.moderatorId).toBe('automod');
        await moderation.recordAction(sys, plan, { applied: true, dmSent: false });
      }
    }
    expect(decisions).toEqual(['DELETE', 'WARN', 'WARN', 'TIMEOUT', 'TIMEOUT', 'TIMEOUT', 'TIMEOUT', 'TIMEOUT']);
    const types = await testDb().moderationAction.findMany({ where: { guildId, targetId: userId }, select: { type: true, moderatorId: true } });
    expect(types.some((t) => t.type === 'BAN')).toBe(false);
    expect(types.every((t) => t.moderatorId === 'automod')).toBe(true);
    expect(await testDb().warning.count({ where: { guildId, userId } })).toBe(2);
  });

  it('only system actors can record hits or link automod events', async () => {
    const guildId = await freshGuild();
    const mod = ctxAs(guildId, 'all');
    await expect(moderation.recordAutomodHit(mod, { userId: snowflake(), channelId: snowflake(), rule: 'BURST' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      moderation.prepareAction(mod, { type: 'WARN', targetId: snowflake(), reason: 'spoofed', automodEventId: 'x' }, subject()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('false-positive review removes the strike and revokes the linked warning (audited)', async () => {
    const guildId = await freshGuild();
    const sys = makeCtx(testDeps(), guildId, systemActor('bot'), 'test');
    const userId = snowflake();
    const channelId = snowflake();
    await moderation.recordAutomodHit(sys, { userId, channelId, rule: 'BURST' });
    const second = await moderation.recordAutomodHit(sys, { userId, channelId, rule: 'BURST' });
    expect(second.decision.action).toBe('WARN');
    const plan = await moderation.prepareAction(sys, { type: 'WARN', targetId: userId, reason: 'Automod: burst', automodEventId: second.event.id }, subject({ actorHighest: 20 }));
    const rec = await moderation.recordAction(sys, plan, { applied: true, dmSent: false });

    await expect(moderation.reviewAutomodEvent(ctxAs(guildId, ['moderation.execute']), second.event.id, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const reviewer = ctxAs(guildId, ['automod.manage']);
    await moderation.reviewAutomodEvent(reviewer, second.event.id, true);
    expect((await testDb().warning.findUnique({ where: { actionId: rec.action.id } }))?.active).toBe(false);
    expect(await testDb().securityAuditEvent.findFirst({ where: { guildId, action: 'automod.event.review' } })).not.toBeNull();
    // Strike count dropped: next hit is the 2nd counted strike again
    const third = await moderation.recordAutomodHit(sys, { userId, channelId, rule: 'BURST' });
    expect(third.decision.strikes).toBe(2);
  });

  it('validates automod config updates', async () => {
    const guildId = await freshGuild();
    const admin = ctxAs(guildId, ['automod.manage']);
    await expect(moderation.updateAutomodConfig(ctxAs(guildId), { maxMentions: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(moderation.updateAutomodConfig(admin, { blockedDomains: ['not a domain'] })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(moderation.updateAutomodConfig(admin, { blockedPhrases: Array.from({ length: 101 }, (_, i) => `phrase${i}`) })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(moderation.updateAutomodConfig(admin, { blockedPhrases: ['x'.repeat(101)] })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(moderation.updateAutomodConfig(admin, { maxMentions: 500 })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(moderation.updateAutomodConfig(admin, { warnAtStrikes: 5, timeoutAtStrikes: 5 })).rejects.toThrow(/higher/);
    const updated = await moderation.updateAutomodConfig(admin, { blockedDomains: ['HTTPS://Evil.Example.com/path', 'evil.example.com.'], blockedPhrases: ['secret phrase'] });
    expect(updated.blockedDomains).toEqual(['evil.example.com']);
    const auditRow = await testDb().securityAuditEvent.findFirst({ where: { guildId, action: 'automod.config.update' } });
    expect(JSON.stringify(auditRow?.metadata)).not.toContain('secret phrase');
  });
});

describe('moderation: appeals', () => {
  it('members can only appeal their own actions, once while pending, rate limited', async () => {
    const guildId = await freshGuild();
    const deps = testDeps();
    const mod = ctxAs(guildId, ['moderation.execute'], { deps });
    const memberId = snowflake();
    const member = ctxAs(guildId, [], { deps, userId: memberId });
    const other = ctxAs(guildId, [], { deps });
    const rec = await moderation.recordAction(
      mod,
      await moderation.prepareAction(mod, { type: 'WARN', targetId: memberId, reason: 'rude' }, subject()),
      { applied: true, dmSent: true },
    );
    const statement = 'I was quoting someone else, please review the context.';

    await expect(moderation.submitAppeal(other, { actionRef: rec.action.ref, statement })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const appeal = await moderation.submitAppeal(member, { actionRef: rec.action.ref.toLowerCase(), statement });
    expect(appeal.actionId).toBe(rec.action.id);
    await expect(moderation.submitAppeal(member, { actionRef: rec.action.ref, statement })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(moderation.submitAppeal(member, { statement })).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    const notify = await testDb().scheduledJob.findUnique({ where: { dedupeKey: `moderation.appeal-notify:${appeal.id}` } });
    expect(notify).not.toBeNull();

    // Own actions list hides moderator identity
    const own = await moderation.listOwnActions(member);
    expect(own.map((a) => a.ref)).toEqual([rec.action.ref]);
    expect(own[0]).not.toHaveProperty('moderatorId');
  });

  it('reviews require the right permission; accepting a warning appeal revokes it and DMs the appellant', async () => {
    const guildId = await freshGuild();
    const deps = testDeps();
    const mod = ctxAs(guildId, ['moderation.execute', 'moderation.ban'], { deps });
    const memberId = snowflake();
    const member = ctxAs(guildId, [], { deps, userId: memberId });
    const warn = await moderation.recordAction(mod, await moderation.prepareAction(mod, { type: 'WARN', targetId: memberId, reason: 'rude' }, subject()), { applied: true, dmSent: true });
    const ban = await moderation.recordAction(mod, await moderation.prepareAction(mod, { type: 'BAN', targetId: memberId, reason: 'spam', duration: '1d' }, subject()), { applied: true, dmSent: true });
    const a1 = await moderation.submitAppeal(member, { actionRef: warn.action.ref, statement: 'This warning was a misunderstanding, sorry.' });
    const a2 = await moderation.submitAppeal(member, { actionRef: ban.action.ref, statement: 'My account was compromised at the time.' });

    const junior = ctxAs(guildId, ['moderation.execute'], { deps });
    await expect(moderation.reviewAppeal(junior, a2.id, { decision: 'ACCEPTED' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(moderation.reviewAppeal(member, a1.id, { decision: 'ACCEPTED' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const r = await moderation.reviewAppeal(junior, a1.id, { decision: 'ACCEPTED', note: 'Context checked' });
    expect(r.appeal.status).toBe('ACCEPTED');
    expect((await testDb().warning.findUnique({ where: { actionId: warn.action.id } }))?.active).toBe(false);
    await expect(moderation.reviewAppeal(junior, a1.id, { decision: 'DENIED' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const banReview = await moderation.reviewAppeal(mod, a2.id, { decision: 'ACCEPTED' });
    expect(banReview.requiresManualReversal).toBe(true);
    expect(await testDb().scheduledJob.findUnique({ where: { dedupeKey: `moderation.appeal-decision-dm:${a1.id}` } })).not.toBeNull();
    expect(await testDb().securityAuditEvent.count({ where: { guildId, action: 'moderation.appeal.review', result: 'SUCCESS' } })).toBe(2);
  });
});
