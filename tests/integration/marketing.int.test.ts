import { afterAll, describe, expect, it } from 'vitest';
import { marketing } from '@gynx/services';
import { ctxAs, fakeDiscord, freshGuild, snowflake, testDb, testDeps } from './helpers';

/** Deps whose fake Discord returns globally unique invite codes. */
const inviteDeps = () => testDeps({ discord: fakeDiscord({ createInvite: async () => ({ code: `c${snowflake()}` }) }) });

const PUBLISHER = ['announcements.create', 'announcements.publish'] as const;

/** "YYYY-MM-DD HH:MM" in UTC, `hours` from now. */
function wallTimeUtc(hours: number): string {
  const d = new Date(Date.now() + hours * 3_600_000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

async function draft(guildId: string, extra: Partial<marketing.CreateAnnouncementInput> = {}) {
  const author = ctxAs(guildId, ['announcements.create']);
  return marketing.createAnnouncement(author, { title: 'Big news', body: 'Something new is here.', channelId: snowflake(), ...extra });
}

describe('marketing: announcements', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('validates drafts (https images, hex colours, lengths, role mentions)', async () => {
    const guildId = await freshGuild();
    const author = ctxAs(guildId, ['announcements.create']);
    const ok = { title: 't', body: 'b', channelId: snowflake() };
    await expect(marketing.createAnnouncement(author, { ...ok, imageUrl: 'http://x.com/a.png' })).rejects.toThrow();
    await expect(marketing.createAnnouncement(author, { ...ok, imageUrl: 'https://127.0.0.1/a.png' })).rejects.toThrow();
    await expect(marketing.createAnnouncement(author, { ...ok, color: 'blue' })).rejects.toThrow();
    await expect(marketing.createAnnouncement(author, { ...ok, body: 'x'.repeat(4001) })).rejects.toThrow();
    await expect(marketing.createAnnouncement(author, { ...ok, title: 'x'.repeat(257) })).rejects.toThrow();
    await expect(marketing.createAnnouncement(author, { ...ok, mention: 'ROLE' })).rejects.toThrow(/role/i);
    await expect(marketing.createAnnouncement(author, { title: 't', body: 'b' })).rejects.toThrow(/channel/i);
    const a = await marketing.createAnnouncement(author, { ...ok, color: '22d3ee' });
    expect(a.color).toBe('#22D3EE');
    expect(a.status).toBe('DRAFT');
    await expect(marketing.createAnnouncement(ctxAs(guildId), ok)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('seeds default templates idempotently and drafts from a template', async () => {
    const guildId = await freshGuild();
    const db = testDb();
    expect(await marketing.seedDefaultTemplates(db, guildId)).toBe(marketing.DEFAULT_TEMPLATES.length);
    expect(await marketing.seedDefaultTemplates(db, guildId)).toBe(0);
    const author = ctxAs(guildId, ['announcements.create']);
    const templates = await marketing.listTemplates(author);
    expect(new Set(templates.map((t) => t.type)).size).toBe(9);
    const maint = templates.find((t) => t.type === 'MAINTENANCE')!;
    const a = await marketing.createAnnouncement(author, { templateId: maint.id, channelId: snowflake() });
    expect(a.type).toBe('MAINTENANCE');
    expect(a.title).toBe(maint.title);
    await expect(marketing.createTemplate(author, { name: maint.name, type: 'GENERAL', title: 't', body: 'b' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('requires publish permission, mass-mention permission and explicit mention confirmation', async () => {
    const guildId = await freshGuild();
    const a = await draft(guildId);
    await expect(marketing.publishAnnouncement(ctxAs(guildId, ['announcements.create']), a.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const loud = await draft(guildId, { mention: 'EVERYONE' });
    const publisher = ctxAs(guildId, [...PUBLISHER]);
    await expect(marketing.publishAnnouncement(publisher, loud.id, { confirmMentions: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const denied = await testDb().securityAuditEvent.findFirst({ where: { guildId, action: 'announcements.mass_mention', result: 'DENIED' } });
    expect(denied).not.toBeNull();
    await expect(marketing.scheduleAnnouncement(publisher, loud.id, { when: wallTimeUtc(24), timezone: 'UTC' }, { confirmMentions: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const massPublisher = ctxAs(guildId, [...PUBLISHER, 'announcements.mass_mention']);
    await expect(marketing.publishAnnouncement(massPublisher, loud.id)).rejects.toThrow(/Confirm/);
    const preview = await marketing.previewAnnouncement(massPublisher, loud.id);
    expect(preview.requiresMentionConfirmation).toBe(true);
    expect(preview.warning).toMatch(/@everyone/);
    expect(preview.payload.allowed_mentions).toEqual({ parse: ['everyone'] });

    // Stale preview version is rejected.
    await expect(marketing.publishAnnouncement(massPublisher, loud.id, { confirmMentions: true, expectedVersion: preview.version + 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    const queued = await marketing.publishAnnouncement(massPublisher, loud.id, { confirmMentions: true, expectedVersion: preview.version });
    expect(queued.status).toBe('SCHEDULED');
    expect(queued.publishedById).toBe(massPublisher.actor.userId);
    const job = await testDb().scheduledJob.findUnique({ where: { dedupeKey: marketing.announcementJobKey(loud.id, queued.version) } });
    expect(job?.status).toBe('PENDING');
  });

  it('schedules in the guild time zone; editing bumps the version and replaces the job', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { timezone: 'America/New_York' } });
    const a = await draft(guildId);
    const publisher = ctxAs(guildId, [...PUBLISHER]);
    const when = new Date(Date.now() + 48 * 3_600_000);
    const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(when)
      .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    const s = await marketing.scheduleAnnouncement(publisher, a.id, { when: `${ny.year}-${ny.month}-${ny.day} ${ny.hour}:${ny.minute}` });
    expect(Math.abs(s.scheduledFor!.getTime() - Math.floor(when.getTime() / 60_000) * 60_000)).toBe(0);

    const edited = await marketing.updateAnnouncement(publisher, a.id, { title: 'Bigger news' });
    expect(edited.version).toBe(s.version + 1);
    const oldJob = await testDb().scheduledJob.findUnique({ where: { dedupeKey: marketing.announcementJobKey(a.id, s.version) } });
    const newJob = await testDb().scheduledJob.findUnique({ where: { dedupeKey: marketing.announcementJobKey(a.id, edited.version) } });
    expect(oldJob?.status).toBe('CANCELLED');
    expect(newJob?.status).toBe('PENDING');
    expect(newJob?.runAt.getTime()).toBe(s.scheduledFor!.getTime());

    // A creator without publish rights cannot alter a scheduled announcement.
    await expect(marketing.updateAnnouncement(ctxAs(guildId, ['announcements.create']), a.id, { title: 'sneaky' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(marketing.scheduleAnnouncement(publisher, a.id, { when: '2020-01-01 10:00', timezone: 'UTC' })).rejects.toThrow(/future/);

    const cancelled = await marketing.cancelAnnouncement(publisher, a.id);
    expect(cancelled.status).toBe('CANCELLED');
    const cancelledJob = await testDb().scheduledJob.findUnique({ where: { dedupeKey: marketing.announcementJobKey(a.id, edited.version) } });
    expect(cancelledJob?.status).toBe('CANCELLED');
  });
});

describe('marketing: tracked links', () => {
  it('creates validated links and counts clicks atomically without visitor data', async () => {
    const guildId = await freshGuild();
    const staff = ctxAs(guildId, ['announcements.create']);
    await expect(marketing.createTrackedLink(staff, { targetUrl: 'http://gynx.gg' })).rejects.toThrow();
    await expect(marketing.createTrackedLink(staff, { targetUrl: 'https://192.168.1.1/' })).rejects.toThrow();
    await expect(marketing.createTrackedLink(ctxAs(guildId), { targetUrl: 'https://gynx.gg' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const link = await marketing.createTrackedLink(staff, { targetUrl: 'https://gynx.gg/games', campaign: 'launch' });
    expect(link.slug).toMatch(/^[0-9A-Za-z]{8}$/);
    const db = testDb();
    await Promise.all([1, 2, 3].map(() => marketing.resolveTrackedLink(db, link.slug)));
    expect(await marketing.resolveTrackedLink(db, link.slug)).toBe('https://gynx.gg/games');
    expect((await db.trackedLink.findUnique({ where: { id: link.id } }))?.clicks).toBe(4);

    expect(await marketing.resolveTrackedLink(db, 'zzzzzzzz')).toBeNull();
    expect(await marketing.resolveTrackedLink(db, '../etc')).toBeNull();
    await marketing.setTrackedLinkActive(staff, link.id, false);
    expect(await marketing.resolveTrackedLink(db, link.slug)).toBeNull();
    expect((await db.trackedLink.findUnique({ where: { id: link.id } }))?.clicks).toBe(4);
  });
});

describe('marketing: referrals', () => {
  const oldAccount = new Date('2022-01-01T00:00:00Z');

  async function setup() {
    const guildId = await freshGuild();
    const deps = inviteDeps();
    const referrer = ctxAs(guildId, [], { deps });
    const { invite } = await marketing.createReferralInvite(referrer, { channelId: snowflake() });
    const system = { ...ctxAs(guildId, 'all', { deps }), actor: { ...ctxAs(guildId, 'all').actor, isSystem: true, userId: 'system' } };
    return { guildId, deps, referrer, invite, system };
  }

  it('gives each member one personal invite and gates campaign invites', async () => {
    const { guildId, deps, referrer, invite } = await setup();
    const again = await marketing.createReferralInvite(referrer, { channelId: snowflake() });
    expect(again.created).toBe(false);
    expect(again.invite.id).toBe(invite.id);
    await expect(marketing.createReferralInvite(referrer, { channelId: snowflake(), campaign: 'summer' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const staff = ctxAs(guildId, ['referrals.manage'], { deps });
    const camp = await marketing.createReferralInvite(staff, { channelId: snowflake(), campaign: 'summer' });
    expect(camp.invite.campaign).toBe('summer');
  });

  it('stores attribution with the right confidence and never fabricates a referrer', async () => {
    const { guildId, referrer, invite, system } = await setup();
    const confirmed = await marketing.recordAttribution(system, { joinedUserId: snowflake(), confidence: 'CONFIRMED', inviteCode: invite.code, inviteUses: 1, accountCreatedAt: oldAccount });
    expect(confirmed).toMatchObject({ confidence: 'CONFIRMED', referrerId: referrer.actor.userId, status: 'VALID' });
    expect((await testDb().referralInvite.findUnique({ where: { id: invite.id } }))?.lastKnownUses).toBe(1);

    const ambiguous = await marketing.recordAttribution(system, { joinedUserId: snowflake(), confidence: 'AMBIGUOUS', inviteCode: invite.code, accountCreatedAt: oldAccount });
    expect(ambiguous).toMatchObject({ confidence: 'AMBIGUOUS', referrerId: null, inviteCode: null });

    const untracked = await marketing.recordAttribution(system, { joinedUserId: snowflake(), confidence: 'CONFIRMED', inviteCode: 'notours', accountCreatedAt: oldAccount });
    expect(untracked).toMatchObject({ confidence: 'UNKNOWN', referrerId: null });

    const unknown = await marketing.recordAttribution(system, { joinedUserId: snowflake(), confidence: 'UNKNOWN' });
    expect(unknown).toMatchObject({ confidence: 'UNKNOWN', referrerId: null });

    // Members cannot record attributions themselves.
    await expect(marketing.recordAttribution(ctxAs(guildId), { joinedUserId: snowflake(), confidence: 'UNKNOWN' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('flags suspicious referrals and excludes them from the leaderboard until reviewed', async () => {
    const { guildId, referrer, invite, system } = await setup();
    const valid = await marketing.recordAttribution(system, { joinedUserId: snowflake(), confidence: 'CONFIRMED', inviteCode: invite.code, accountCreatedAt: oldAccount });
    const fresh = await marketing.recordAttribution(system, { joinedUserId: snowflake(), confidence: 'CONFIRMED', inviteCode: invite.code, accountCreatedAt: new Date() });
    expect(fresh.status).toBe('FLAGGED');
    expect(fresh.flagReason).toMatch(/younger than 7 days/);
    const rejoin = await marketing.recordAttribution(system, { joinedUserId: valid.joinedUserId, confidence: 'CONFIRMED', inviteCode: invite.code, accountCreatedAt: oldAccount });
    expect(rejoin.flagReason).toMatch(/rejoin/);
    const self = await marketing.recordAttribution(system, { joinedUserId: referrer.actor.userId, confidence: 'CONFIRMED', inviteCode: invite.code, accountCreatedAt: oldAccount });
    expect(self.flagReason).toMatch(/themselves/);

    const member = ctxAs(guildId);
    let board = await marketing.referralLeaderboard(member, '7');
    expect(board).toEqual([{ rank: 1, referrerId: referrer.actor.userId, referrals: 1 }]);

    const staff = ctxAs(guildId, ['referrals.manage']);
    await expect(marketing.reviewAttribution(member, fresh.id, { status: 'VALID', note: 'looks fine' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await marketing.reviewAttribution(staff, fresh.id, { status: 'VALID', note: 'Verified real friend' });
    await marketing.reviewAttribution(staff, self.id, { status: 'INVALID', note: 'Self referral' });
    board = await marketing.referralLeaderboard(member, 'all');
    expect(board[0]?.referrals).toBe(2);
    const audited = await testDb().securityAuditEvent.count({ where: { guildId, action: 'referrals.attribution.review', result: 'SUCCESS' } });
    expect(audited).toBe(2);

    const stats = await marketing.myReferralStats(referrer);
    expect(stats).toMatchObject({ valid: 2, underReview: 1, invalid: 1 });
  });

  it('flags bursts of joins through one invite', async () => {
    const { invite, system } = await setup();
    const rows = [];
    for (let n = 0; n < 6; n++) rows.push(await marketing.recordAttribution(system, { joinedUserId: snowflake(), confidence: 'CONFIRMED', inviteCode: invite.code, accountCreatedAt: oldAccount }));
    expect(rows.slice(0, 5).every((r) => r.status === 'VALID')).toBe(true);
    expect(rows[5]!.status).toBe('FLAGGED');
    expect(rows[5]!.flagReason).toMatch(/10 minutes/);
  });
});

describe('marketing: partners', () => {
  const answers = { community: 'Blocky Builders · https://example.com', size: '2,000', games: 'Minecraft', proposal: 'Co-host monthly build events @everyone' };

  it('allows one open application per member and neutralises mentions', async () => {
    const guildId = await freshGuild();
    const applicant = ctxAs(guildId);
    const app = await marketing.submitPartnerApplication(applicant, { category: 'GAMING_COMMUNITY', answers });
    expect(app.ref).toBe('P-0001');
    // Stored faithfully; neutralised wherever it is echoed.
    const embed = JSON.stringify(marketing.partnerApplicationEmbed(app));
    expect(embed).toContain('Co-host monthly build events');
    expect(embed).not.toMatch(/(?<!\\u200b)@everyone/);
    expect(JSON.stringify(marketing.partnerDecisionEmbed({ ref: 'P-1', status: 'APPROVED', decisionNote: 'hi @here' }))).not.toMatch(/(?<!\\u200b)@here/);
    await expect(marketing.submitPartnerApplication(applicant, { category: 'OTHER', answers: { about: 'x', proposal: 'y' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(marketing.submitPartnerApplication(ctxAs(guildId), { category: 'GAMING_COMMUNITY', answers: { ...answers, extra: 'x' } })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(marketing.submitPartnerApplication(ctxAs(guildId), { category: 'GAMING_COMMUNITY', answers: { size: '1' } })).rejects.toMatchObject({ code: 'VALIDATION' });

    // Concurrent submissions by another member: exactly one succeeds.
    const other = ctxAs(guildId);
    const results = await Promise.allSettled([1, 2, 3].map(() => marketing.submitPartnerApplication(other, { category: 'GAMING_COMMUNITY', answers })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const job = await testDb().scheduledJob.findUnique({ where: { dedupeKey: `marketing.partner.notify:${app.id}` } });
    expect(job?.status).toBe('PENDING');
  });

  it('runs the review flow with internal notes hidden from the applicant', async () => {
    const guildId = await freshGuild();
    const applicant = ctxAs(guildId);
    const app = await marketing.submitPartnerApplication(applicant, { category: 'GAMING_COMMUNITY', answers });
    await expect(marketing.startPartnerReview(applicant, app.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const reviewer = ctxAs(guildId, ['partners.review']);
    const started = await marketing.startPartnerReview(reviewer, app.id);
    expect(started.status).toBe('UNDER_REVIEW');
    expect(started.reviewStartedAt).not.toBeNull();
    await expect(marketing.decidePartnerApplication(ctxAs(guildId, ['partners.review']), app.id, { decision: 'APPROVED', decisionNote: 'Looks good' })).rejects.toMatchObject({ code: 'CONFLICT' });

    const { application, campaign } = await marketing.decidePartnerApplication(reviewer, app.id, {
      decision: 'APPROVED',
      decisionNote: 'Welcome aboard!',
      internalNotes: 'Checked their Discord, ~2k real members.',
      campaignName: 'Blocky Builders',
    });
    expect(application.status).toBe('APPROVED');
    expect(campaign?.canAnnounce).toBe(false);
    const mine = await marketing.myPartnerApplications(applicant);
    expect(JSON.stringify(mine)).not.toContain('Checked their Discord');
    expect(mine[0]?.decisionNote).toBe('Welcome aboard!');
    expect(await testDb().scheduledJob.findUnique({ where: { dedupeKey: `marketing.partner.decision:${app.id}` } })).not.toBeNull();

    // canAnnounce needs settings.manage.
    await expect(marketing.updatePartnerCampaign(reviewer, campaign!.id, { canAnnounce: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const admin = ctxAs(guildId, ['partners.review', 'settings.manage']);
    expect((await marketing.updatePartnerCampaign(admin, campaign!.id, { canAnnounce: true })).canAnnounce).toBe(true);

    // Campaign analytics: invites + links attributed to the campaign.
    const deps = inviteDeps();
    const staffWithDeps = ctxAs(guildId, ['partners.review', 'referrals.manage'], { deps });
    const { invite } = await marketing.createReferralInvite(staffWithDeps, { channelId: snowflake(), partnerCampaignId: campaign!.id });
    expect(invite.ownerId).toBe(applicant.actor.userId);
    const link = await marketing.createTrackedLink(staffWithDeps, { targetUrl: 'https://gynx.gg/partner', partnerCampaignId: campaign!.id });
    await marketing.resolveTrackedLink(testDb(), link.slug);
    const system = { ...staffWithDeps, actor: { ...staffWithDeps.actor, isSystem: true } };
    await marketing.recordAttribution(system, { joinedUserId: snowflake(), confidence: 'CONFIRMED', inviteCode: invite.code, accountCreatedAt: new Date('2020-01-01') });
    const stats = await marketing.partnerCampaignAnalytics(applicant, campaign!.id);
    expect(stats).toMatchObject({ validJoins: 1, linkClicks: 1 });
    await expect(marketing.partnerCampaignAnalytics(ctxAs(guildId), campaign!.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
