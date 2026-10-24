import { afterAll, describe, expect, it } from 'vitest';
import { community, makeCtx, systemActor } from '@gynx/services';
import { ctxAs, freshGuild, snowflake, testDb, testDeps } from './helpers';

const P = { ...community.DANGEROUS_PERMISSIONS, SendMessages: 1n << 11n };
const plainPerms = P.SendMessages.toString();
const live = (roleId: string, over: Partial<community.RoleMeta> = {}): community.LiveRoleContext => ({
  role: { id: roleId, position: 3, managed: false, permissions: plainPerms, ...over },
  botHighestPosition: 10,
});
const manager = (guildId: string, deps = testDeps()) => ctxAs(guildId, ['community.manage'], { deps });

afterAll(async () => {
  await testDb().$disconnect();
});

describe('community: FAQ', () => {
  it('denies FAQ/guide/self-role/welcome edits to members and audits the denial', async () => {
    const guildId = await freshGuild();
    const member = ctxAs(guildId);
    const entry = { question: 'How do I reset my password?', answer: 'Use the account page.' };
    await expect(community.createFaqEntry(member, entry)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(community.createFaqCategory(member, { name: 'Accounts' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      community.createGuide(member, {
        title: 'Setup',
        category: 'Basics',
        summary: 'Getting started',
        url: 'https://gynx.gg/docs',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(community.updateWelcomeConfig(member, { title: 'Hi' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      community.createSelfRole(member, { roleId: snowflake(), label: 'Rust' }, live(snowflake())),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const created = await community.createFaqEntry(manager(guildId), { ...entry, published: true });
    await expect(community.updateFaqEntry(member, created.id, { answer: 'hacked' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(community.deleteFaqEntry(member, created.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(community.listFaqEntries(member, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const denials = await testDb().securityAuditEvent.count({ where: { guildId, result: 'DENIED' } });
    expect(denials).toBeGreaterThanOrEqual(8);
  });

  it('full CRUD with audit, https-only links and lower-cased keywords', async () => {
    const guildId = await freshGuild();
    const staff = manager(guildId);
    const cat = await community.createFaqCategory(staff, { name: 'Server Setup' });
    expect(cat.slug).toBe('server-setup');
    await expect(community.createFaqCategory(staff, { name: 'Server Setup' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    await expect(
      community.createFaqEntry(staff, {
        question: 'Where is the panel?',
        answer: 'x',
        links: [{ label: 'Panel', url: 'http://insecure.example.com' }],
      }),
    ).rejects.toThrow();
    await expect(
      community.createFaqEntry(staff, {
        question: 'Where is the panel?',
        answer: 'x',
        links: [{ label: 'Panel', url: 'javascript:alert(1)' }],
      }),
    ).rejects.toThrow();

    const entry = await community.createFaqEntry(staff, {
      categoryId: cat.id,
      question: 'Where is the panel?',
      answer: 'Log in on the website.',
      keywords: ['Panel', 'LOGIN', 'panel'],
      links: [{ label: 'Website', url: 'https://gynx.gg' }],
    });
    expect(entry.keywords).toEqual(['panel', 'login']);
    const updated = await community.updateFaqEntry(staff, entry.id, { published: true });
    expect(updated.published).toBe(true);
    await community.deleteFaqCategory(staff, cat.id);
    const orphan = await testDb().faqEntry.findUnique({ where: { id: entry.id } });
    expect(orphan?.categoryId).toBeNull();
    await community.deleteFaqEntry(staff, entry.id);

    const actions = (
      await testDb().securityAuditEvent.findMany({
        where: { guildId, result: 'SUCCESS' },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'community.faq.category.create',
        'community.faq.create',
        'community.faq.update',
        'community.faq.delete',
        'community.faq.category.delete',
      ]),
    );
  });

  it('hides unpublished entries from members (search, get, most viewed, categories)', async () => {
    const guildId = await freshGuild();
    const staff = manager(guildId);
    const cat = await community.createFaqCategory(staff, { name: 'Drafts' });
    const draft = await community.createFaqEntry(staff, {
      categoryId: cat.id,
      question: 'Secret upcoming feature?',
      answer: 'Launching soon',
      keywords: ['secret'],
    });
    const pub = await community.createFaqEntry(staff, {
      question: 'How do I join a server?',
      answer: 'Use the IP from the panel.',
      keywords: ['join'],
      published: true,
    });

    const member = ctxAs(guildId);
    expect((await community.searchFaq(member, { query: 'secret' })).items).toHaveLength(0);
    await expect(community.getFaqEntry(member, draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(community.viewFaqEntry(member, draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(community.recordFaqFeedback(member, draft.id, true)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await community.mostViewedFaq(member)).map((e) => e.id)).toEqual([pub.id]);
    expect((await community.suggestFaqQuestions(member, 'secret')).length).toBe(0);
    expect(await community.listFaqCategories(member)).toHaveLength(0); // only categories with published entries

    // Even staff search only returns published entries (member-facing search).
    expect((await community.searchFaq(staff, { query: 'secret' })).items).toHaveLength(0);
    expect((await community.getFaqEntry(staff, draft.id, { includeDrafts: true })).id).toBe(draft.id);
  });

  it('searches published entries with ranking and pagination, and counts views once per window', async () => {
    const guildId = await freshGuild();
    const staff = manager(guildId);
    const kw = await community.createFaqEntry(staff, {
      question: 'Changing settings',
      answer: 'Open settings.',
      keywords: ['port'],
      published: true,
    });
    const q = await community.createFaqEntry(staff, {
      question: 'Which PORT does my server use?',
      answer: 'See the panel.',
      published: true,
    });
    const a = await community.createFaqEntry(staff, {
      question: 'Networking basics',
      answer: 'The port is on the dashboard.',
      published: true,
    });

    const member = ctxAs(guildId);
    const page1 = await community.searchFaq(member, { query: 'Port', pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.pageCount).toBe(2);
    expect(page1.items.map((e) => e.id)).toEqual([kw.id, q.id]);
    const page2 = await community.searchFaq(member, { query: 'port', pageSize: 2, page: 2 });
    expect(page2.items.map((e) => e.id)).toEqual([a.id]);

    await community.viewFaqEntry(member, a.id);
    await community.viewFaqEntry(member, a.id);
    await community.viewFaqEntry(ctxAs(guildId, [], { deps: member }), a.id);
    expect((await testDb().faqEntry.findUnique({ where: { id: a.id } }))?.views).toBe(2);
    expect((await community.mostViewedFaq(member, 1))[0]?.id).toBe(a.id);
  });

  it('rate-limits helpful votes per user per entry', async () => {
    const guildId = await freshGuild();
    const deps = testDeps();
    const entry = await community.createFaqEntry(manager(guildId, deps), {
      question: 'Is DDoS protection included?',
      answer: 'Yes.',
      published: true,
    });
    const voter = ctxAs(guildId, [], { deps });
    await community.recordFaqFeedback(voter, entry.id, true);
    await expect(community.recordFaqFeedback(voter, entry.id, true)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(community.recordFaqFeedback(voter, entry.id, false)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await community.recordFaqFeedback(ctxAs(guildId, [], { deps }), entry.id, false);
    const row = await testDb().faqEntry.findUnique({ where: { id: entry.id } });
    expect(row).toMatchObject({ helpfulYes: 1, helpfulNo: 1 });
  });

  it('lists only published guides with filters and pagination', async () => {
    const guildId = await freshGuild();
    const staff = manager(guildId);
    for (let n = 0; n < 7; n++) {
      await community.createGuide(staff, {
        title: `Minecraft guide ${n}`,
        category: 'Setup',
        summary: 'How to',
        url: `https://gynx.gg/g/${n}`,
        game: 'Minecraft',
        published: true,
      });
    }
    await community.createGuide(staff, {
      title: 'Rust draft',
      category: 'Setup',
      summary: 'WIP',
      url: 'https://gynx.gg/rust',
      game: 'Rust',
    });
    await expect(
      community.createGuide(staff, { title: 'Bad', category: 'Setup', summary: 'x', url: 'http://gynx.gg' }),
    ).rejects.toThrow();

    const member = ctxAs(guildId);
    const p1 = await community.listGuides(member, { pageSize: 5 });
    expect(p1).toMatchObject({ total: 7, pageCount: 2, page: 1 });
    expect((await community.listGuides(member, { game: 'rust' })).total).toBe(0);
    expect(
      (await community.listGuides(member, { game: 'minecraft', page: 2, pageSize: 5 })).items,
    ).toHaveLength(2);
    expect((await community.guideFacets(member)).games).toEqual(['Minecraft']);
  });
});

describe('community: self-assignable roles', () => {
  it('rejects privileged, managed, hierarchy, @everyone, staff and partner roles when allowlisting', async () => {
    const guildId = await freshGuild();
    const staff = manager(guildId);
    const add = (roleId: string, l: community.LiveRoleContext) =>
      community.createSelfRole(staff, { roleId, label: 'Role' }, l);

    await expect(add(guildId, live(guildId))).rejects.toThrow(/@everyone/);
    let id = snowflake();
    await expect(add(id, live(id, { managed: true }))).rejects.toThrow(/managed/);
    id = snowflake();
    await expect(add(id, live(id, { position: 10 }))).rejects.toThrow(/highest role/);
    id = snowflake();
    await expect(add(id, live(id, { permissions: P.Administrator.toString() }))).rejects.toThrow(
      /privileged/,
    );
    id = snowflake();
    await expect(
      add(id, live(id, { permissions: (P.SendMessages | P.ManageRoles).toString() })),
    ).rejects.toThrow(/ManageRoles/);
    // Mismatched live data is rejected (caller must describe the same role).
    await expect(add(snowflake(), live(snowflake()))).rejects.toMatchObject({ code: 'VALIDATION' });

    const staffRole = snowflake();
    await testDb().staffPermission.create({
      data: {
        guildId,
        subjectType: 'ROLE',
        subjectId: staffRole,
        permission: 'SUPPORT_STAFF',
        createdById: 'system',
      },
    });
    await expect(add(staffRole, live(staffRole))).rejects.toThrow(/Staff/);

    const partnerRole = snowflake();
    const escalationRole = snowflake();
    await testDb().guildConfig.update({
      where: { guildId },
      data: { partnerRoleId: partnerRole, escalationRoleId: escalationRole },
    });
    await expect(add(partnerRole, live(partnerRole))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(add(escalationRole, live(escalationRole))).rejects.toMatchObject({ code: 'VALIDATION' });

    const ok = snowflake();
    const row = await add(ok, live(ok));
    expect(row.enabled).toBe(true);
    await expect(add(ok, live(ok))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('re-checks the allowlist at toggle time (disabled / removed roles are rejected)', async () => {
    const guildId = await freshGuild();
    const staff = manager(guildId);
    const roleId = snowflake();
    const entry = await community.createSelfRole(
      staff,
      { roleId, label: 'Valheim', group: 'games' },
      live(roleId),
    );

    const member = ctxAs(guildId);
    expect(await community.toggleSelfRole(member, roleId, live(roleId))).toMatchObject({
      action: 'add',
      roleId,
    });
    const holder = ctxAs(guildId, [], { roleIds: [roleId] });
    expect(await community.toggleSelfRole(holder, roleId, live(roleId))).toMatchObject({ action: 'remove' });

    // Role became privileged after allowlisting → rejected at toggle time.
    await expect(
      community.toggleSelfRole(member, roleId, live(roleId, { permissions: P.BanMembers.toString() })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await community.updateSelfRole(staff, entry.id, { enabled: false });
    await expect(community.toggleSelfRole(member, roleId, live(roleId))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(community.updateSelfRole(staff, entry.id, { enabled: true })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await community.updateSelfRole(staff, entry.id, { enabled: true }, live(roleId));
    await community.deleteSelfRole(staff, entry.id);
    await expect(community.toggleSelfRole(member, roleId, live(roleId))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // A role that was never allowlisted is rejected regardless of its customId.
    const other = snowflake();
    await expect(community.toggleSelfRole(member, other, live(other))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('interests accept only enabled game roles', async () => {
    const guildId = await freshGuild();
    const staff = manager(guildId);
    const game = snowflake();
    const notif = snowflake();
    await community.createSelfRole(staff, { roleId: game, label: 'Rust', group: 'games' }, live(game));
    await community.createSelfRole(
      staff,
      { roleId: notif, label: 'News', group: 'notifications' },
      live(notif),
    );
    const roles = [live(game).role, live(notif).role];

    const member = ctxAs(guildId);
    await expect(
      community.selectInterests(member, [notif], { roles, botHighestPosition: 10 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const sel = await community.selectInterests(member, [game], { roles, botHighestPosition: 10 });
    expect(sel.add.map((c) => c.roleId)).toEqual([game]);
    const rec = await testDb().onboardingRecord.findUnique({
      where: { guildId_userId: { guildId, userId: member.actor.userId } },
    });
    expect(rec?.interests).toEqual([game]);
  });
});

describe('community: onboarding & anti-raid', () => {
  const sys = (guildId: string, deps = testDeps()) => makeCtx(deps, guildId, systemActor('bot'));

  it('records joins and leaves with member events', async () => {
    const guildId = await freshGuild();
    const ctx = sys(guildId);
    const userId = snowflake();
    const res = await community.recordJoin(ctx, {
      userId,
      joinedAt: new Date(),
      accountCreatedAt: new Date(Date.now() - 400 * 86_400_000),
      memberCount: 42,
    });
    expect(res.record.leftAt).toBeNull();
    expect(res.raid.isRaid).toBe(false);
    expect(res.requiresVerification).toBe(false);
    expect((await testDb().guild.findUnique({ where: { id: guildId } }))?.memberCount).toBe(42);

    await community.recordLeave(ctx, { userId, memberCount: 41 });
    const rec = await testDb().onboardingRecord.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    expect(rec?.leftAt).not.toBeNull();
    const events = await testDb().memberEvent.findMany({
      where: { guildId, userId },
      orderBy: { at: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['JOIN', 'LEAVE']);

    // Rejoin clears leftAt and restarts verification.
    const again = await community.recordJoin(ctx, {
      userId,
      joinedAt: new Date(),
      accountCreatedAt: new Date(0),
    });
    expect(again.record.leftAt).toBeNull();
    expect(await testDb().onboardingRecord.count({ where: { guildId, userId } })).toBe(1);
  });

  it('flags a raid, enqueues exactly one alert per window bucket, and requires verification when configured', async () => {
    const guildId = await freshGuild();
    await testDb().welcomeConfig.update({
      where: { guildId },
      data: { raidJoinThreshold: 3, raidWindowSeconds: 600, raidAction: 'REQUIRE_VERIFICATION' },
    });
    // Fixed clock at the start of a bucket so all joins land in the same one.
    const base = Math.ceil(Date.now() / 600_000) * 600_000 + 1000;
    let t = base;
    const deps = testDeps({ now: () => new Date(t) });
    const ctx = sys(guildId, deps);
    const join = () =>
      community.recordJoin(ctx, {
        userId: snowflake(),
        joinedAt: new Date(t),
        accountCreatedAt: new Date(0),
      });

    const r1 = await join();
    t += 1000;
    const r2 = await join();
    expect(r1.raid.isRaid || r2.raid.isRaid).toBe(false);
    t += 1000;
    const r3 = await join();
    expect(r3.raid).toMatchObject({ isRaid: true, joinsInWindow: 3 });
    expect(r3.requiresVerification).toBe(true);
    expect(r3.record.raidFlagged).toBe(true);
    t += 1000;
    const r4 = await join();
    expect(r4.raid.isRaid).toBe(true);

    expect(await testDb().onboardingRecord.count({ where: { guildId, raidFlagged: true } })).toBe(4);
    const jobs = await testDb().scheduledJob.findMany({ where: { guildId, type: community.RAID_ALERT_JOB } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.dedupeKey).toBe(
      community.raidAlertDedupeKey(guildId, community.raidBucket(new Date(base), 600)),
    );
    expect(
      await testDb().securityAuditEvent.count({ where: { guildId, action: 'community.raid.detected' } }),
    ).toBe(1);

    // The next window bucket gets its own alert.
    t = base + 600_000;
    await join();
    await join();
    await join();
    expect(await testDb().scheduledJob.count({ where: { guildId, type: community.RAID_ALERT_JOB } })).toBe(2);
  });

  it('requires verification for new accounts and returns the verified role on completion', async () => {
    const guildId = await freshGuild();
    const verifiedRoleId = snowflake();
    const staff = manager(guildId);
    await expect(community.updateWelcomeConfig(staff, { verificationEnabled: true })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      community.updateWelcomeConfig(
        staff,
        { verifiedRoleId },
        live(verifiedRoleId, { permissions: P.Administrator.toString() }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await community.updateWelcomeConfig(
      staff,
      { verifiedRoleId, minAccountAgeDays: 7 },
      live(verifiedRoleId),
    );

    const userId = snowflake();
    const res = await community.recordJoin(sys(guildId), {
      userId,
      joinedAt: new Date(),
      accountCreatedAt: new Date(Date.now() - 86_400_000),
    });
    expect(res.isNewAccount).toBe(true);
    expect(res.requiresVerification).toBe(true);

    const member = ctxAs(guildId, [], { userId });
    const v = await community.completeVerification(member);
    expect(v).toEqual({ verifiedRoleId, alreadyVerified: false });
    expect((await community.completeVerification(member)).alreadyVerified).toBe(true);
    const status = await community.getOnboardingStatus(member);
    expect(status).toMatchObject({ verified: true, rulesAccepted: true });

    // The verified role can never be self-assigned.
    await expect(
      community.createSelfRole(staff, { roleId: verifiedRoleId, label: 'Verified' }, live(verifiedRoleId)),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('validates the welcome config', async () => {
    const guildId = await freshGuild();
    const staff = manager(guildId);
    await expect(community.updateWelcomeConfig(staff, { message: 'Hi {user} on {servr}' })).rejects.toThrow(
      /Unknown placeholder/,
    );
    await expect(community.updateWelcomeConfig(staff, { message: 'x'.repeat(2001) })).rejects.toThrow();
    await expect(community.updateWelcomeConfig(staff, { docsUrl: 'http://gynx.gg' })).rejects.toThrow();
    await expect(community.updateWelcomeConfig(staff, { channelId: 'general' })).rejects.toThrow();
    await expect(community.updateWelcomeConfig(staff, { minAccountAgeDays: 366 })).rejects.toThrow();
    await expect(community.updateWelcomeConfig(staff, { raidJoinThreshold: 1 })).rejects.toThrow();
    const ok = await community.updateWelcomeConfig(staff, {
      message: 'Hey {user}, welcome to {server}!',
      supportUrl: 'https://support.gynx.gg',
    });
    expect(
      community.renderWelcomeMessage(ok.message, {
        userId: '123456789012345678',
        serverName: 'GYNX @everyone',
      }),
    ).toBe('Hey <@123456789012345678>, welcome to GYNX @​everyone!');
    expect(await community.resolveSupportUrl(testDb(), guildId)).toBe('https://support.gynx.gg');
    expect(
      await testDb().securityAuditEvent.count({
        where: { guildId, action: 'community.welcome.update', result: 'SUCCESS' },
      }),
    ).toBe(1);
  });

  it('purges old member events and records of members who left beyond retention', async () => {
    const guildId = await freshGuild();
    const ctx = sys(guildId);
    const stayed = snowflake();
    const left = snowflake();
    await community.recordJoin(ctx, { userId: stayed, joinedAt: new Date(), accountCreatedAt: new Date(0) });
    await community.recordJoin(ctx, { userId: left, joinedAt: new Date(), accountCreatedAt: new Date(0) });
    await community.recordLeave(ctx, { userId: left });

    expect(await community.purgeCommunityData(testDb(), guildId, new Date())).toEqual({
      memberEvents: 0,
      onboardingRecords: 0,
    });
    const later = new Date(Date.now() + 121 * 86_400_000);
    expect(await community.purgeCommunityData(testDb(), guildId, later)).toEqual({
      memberEvents: 3,
      onboardingRecords: 1,
    });
    expect(
      await testDb().onboardingRecord.findMany({ where: { guildId }, select: { userId: true } }),
    ).toEqual([{ userId: stayed }]);
  });
});
