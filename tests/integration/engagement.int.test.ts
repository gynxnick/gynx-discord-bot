import { afterAll, describe, expect, it } from 'vitest';
import { engagement } from '@gynx/services';
import { ctxAs, freshGuild, snowflake, testDb, testDeps } from './helpers';

const CHANNEL = '333333333333333333';

/** "YYYY-MM-DD HH:MM" in UTC, `ms` from now. */
function wallClockUtc(ms: number): string {
  return new Date(Date.now() + ms).toISOString().slice(0, 16).replace('T', ' ');
}

async function makeEvent(guildId: string, extra: Partial<engagement.CreateEventInput> = {}) {
  const staff = ctxAs(guildId, ['events.manage']);
  return engagement.createEvent(staff, {
    title: 'Community game night',
    description: 'Join us for a relaxed evening of games.',
    startsAt: wallClockUtc(2 * 86_400_000),
    timezone: 'UTC',
    channelId: CHANNEL,
    ...extra,
  });
}

const member = (guildId: string) => ctxAs(guildId, []);
const deniedCount = (guildId: string) => testDb().securityAuditEvent.count({ where: { guildId, result: 'DENIED' } });

describe('engagement: events', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('stores startsAt in UTC from guild-zone input and schedules reminder jobs', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { timezone: 'America/New_York' } });
    const staff = ctxAs(guildId, ['events.manage']);
    const year = new Date().getUTCFullYear() + 1;
    const ev = await engagement.createEvent(staff, {
      title: 'Winter tournament',
      description: 'Bracket starts at 6pm Eastern.',
      startsAt: `${year}-01-15 18:00`,
      reminderMinutesBefore: [60, 15],
      channelId: CHANNEL,
    });
    expect(ev.startsAt.toISOString()).toBe(`${year}-01-15T23:00:00.000Z`);
    expect(ev.timezone).toBe('America/New_York');
    const jobs = await testDb().scheduledJob.findMany({ where: { dedupeKey: { startsWith: `engagement.event.reminder:${ev.id}:` } } });
    expect(jobs).toHaveLength(2);
    expect(await testDb().scheduledJob.count({ where: { dedupeKey: `engagement.event.publish:${ev.id}` } })).toBe(1);
  });

  it('never exceeds capacity under concurrent RSVPs (10 users, capacity 3)', async () => {
    const guildId = await freshGuild();
    const ev = await makeEvent(guildId, { capacity: 3, waitlistEnabled: true });
    const results = await Promise.all(Array.from({ length: 10 }, () => engagement.rsvpEvent(member(guildId), ev.id, 'GOING')));
    expect(results.filter((r) => r.status === 'GOING')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'WAITLIST')).toHaveLength(7);
    expect(await testDb().eventRsvp.count({ where: { eventId: ev.id, status: 'GOING' } })).toBe(3);
  });

  it('rejects when full and waitlist is disabled', async () => {
    const guildId = await freshGuild();
    const ev = await makeEvent(guildId, { capacity: 1, waitlistEnabled: false });
    await engagement.rsvpEvent(member(guildId), ev.id, 'GOING');
    await expect(engagement.rsvpEvent(member(guildId), ev.id, 'GOING')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('promotes the earliest waitlisted member when a GOING member cancels, and DMs them', async () => {
    const guildId = await freshGuild();
    const ev = await makeEvent(guildId, { capacity: 1 });
    const a = member(guildId);
    const b = member(guildId);
    const c = member(guildId);
    expect((await engagement.rsvpEvent(a, ev.id, 'GOING')).status).toBe('GOING');
    const rb = await engagement.rsvpEvent(b, ev.id, 'GOING');
    expect(rb).toMatchObject({ status: 'WAITLIST', waitlistPosition: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect((await engagement.rsvpEvent(c, ev.id, 'GOING')).waitlistPosition).toBe(2);

    const cancel = await engagement.rsvpEvent(a, ev.id, 'NOT_GOING');
    expect(cancel.promotedUserId).toBe(b.actor.userId);
    const rows = await testDb().eventRsvp.findMany({ where: { eventId: ev.id } });
    expect(rows.find((r) => r.userId === b.actor.userId)?.status).toBe('GOING');
    expect(rows.find((r) => r.userId === c.actor.userId)?.status).toBe('WAITLIST');
    const dm = await testDb().scheduledJob.findFirst({ where: { type: 'engagement.dm', dedupeKey: { startsWith: 'engagement.dm:event.promoted:' }, guildId } });
    expect((dm?.payload as { userId?: string }).userId).toBe(b.actor.userId);
  });

  it('reschedule cancels old reminder jobs and enqueues new ones keyed by the new start', async () => {
    const guildId = await freshGuild();
    const ev = await makeEvent(guildId, { reminderMinutesBefore: [30] });
    const staff = ctxAs(guildId, ['events.manage']);
    const updated = await engagement.updateEvent(staff, ev.id, { startsAt: wallClockUtc(3 * 86_400_000), timezone: 'UTC' });
    const jobs = await testDb().scheduledJob.findMany({ where: { dedupeKey: { startsWith: `engagement.event.reminder:${ev.id}:` } } });
    expect(jobs.find((j) => j.dedupeKey.includes(`:${ev.startsAt.getTime()}:`))?.status).toBe('CANCELLED');
    expect(jobs.find((j) => j.dedupeKey.includes(`:${updated.startsAt.getTime()}:`))?.status).toBe('PENDING');
  });

  it('cancel stops reminders, blocks RSVPs and queues attendee notifications', async () => {
    const guildId = await freshGuild();
    const ev = await makeEvent(guildId);
    await engagement.rsvpEvent(member(guildId), ev.id, 'GOING');
    await engagement.cancelEvent(ctxAs(guildId, ['events.manage']), ev.id, 'Host unavailable');
    expect(await testDb().scheduledJob.count({ where: { dedupeKey: { startsWith: `engagement.event.reminder:${ev.id}:` }, status: 'PENDING' } })).toBe(0);
    expect(await testDb().scheduledJob.count({ where: { dedupeKey: `engagement.event.cancelled:${ev.id}` } })).toBe(1);
    await expect(engagement.rsvpEvent(member(guildId), ev.id, 'GOING')).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('denies event management to members (audited)', async () => {
    const guildId = await freshGuild();
    const ev = await makeEvent(guildId);
    await expect(
      engagement.createEvent(member(guildId), { title: 'Nope', description: 'x', startsAt: wallClockUtc(86_400_000), channelId: CHANNEL }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(engagement.cancelEvent(member(guildId), ev.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(engagement.postEventSummary(member(guildId), ev.id, 'A great night was had by all.')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(engagement.listEventAttendees(member(guildId), ev.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await deniedCount(guildId)).toBe(4);
  });
});

describe('engagement: polls', () => {
  async function makePoll(guildId: string, extra: Partial<engagement.CreatePollInput> = {}) {
    return engagement.createPoll(ctxAs(guildId, ['polls.manage']), {
      question: 'Which game next?',
      options: ['Minecraft', 'Valheim', 'Rust'],
      durationMs: 3_600_000,
      channelId: CHANNEL,
      ...extra,
    });
  }

  it('one ballot per user; changing your vote replaces it', async () => {
    const guildId = await freshGuild();
    const poll = await makePoll(guildId);
    const voter = member(guildId);
    const [o1, o2] = poll.options;
    await engagement.votePoll(voter, poll.id, [o1!.id]);
    const r = await engagement.votePoll(voter, poll.id, [o2!.id]);
    expect(r.changed).toBe(true);
    expect(await testDb().pollBallot.count({ where: { pollId: poll.id } })).toBe(1);
    const votes = await testDb().pollVote.findMany({ where: { pollId: poll.id } });
    expect(votes.map((v) => v.optionId)).toEqual([o2!.id]);
    await expect(engagement.votePoll(voter, poll.id, [o1!.id, o2!.id])).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('concurrent duplicate votes by the same user still yield one ballot', async () => {
    const guildId = await freshGuild();
    const poll = await makePoll(guildId, { multipleChoice: true, maxChoices: 2 });
    const voter = member(guildId);
    await Promise.all([
      engagement.votePoll(voter, poll.id, [poll.options[0]!.id]),
      engagement.votePoll(voter, poll.id, [poll.options[1]!.id, poll.options[2]!.id]),
    ]);
    expect(await testDb().pollBallot.count({ where: { pollId: poll.id } })).toBe(1);
    const n = await testDb().pollVote.count({ where: { pollId: poll.id } });
    expect([1, 2]).toContain(n);
  });

  it('rejects votes after close and after endsAt', async () => {
    const guildId = await freshGuild();
    const poll = await makePoll(guildId);
    await engagement.closePoll(ctxAs(guildId, ['polls.manage']), poll.id);
    await expect(engagement.votePoll(member(guildId), poll.id, [poll.options[0]!.id])).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(engagement.closePoll(ctxAs(guildId, ['polls.manage']), poll.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const p2 = await makePoll(guildId, { durationMs: 60_000 });
    const late = ctxAs(guildId, [], { deps: testDeps({ now: () => new Date(Date.now() + 120_000) }) });
    await expect(engagement.votePoll(late, p2.id, [p2.options[0]!.id])).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('anonymous polls never expose voter ids, even to managers; non-anonymous voters only to managers', async () => {
    const guildId = await freshGuild();
    const manager = ctxAs(guildId, ['polls.manage']);
    const anon = await makePoll(guildId, { anonymous: true });
    const voters = [member(guildId), member(guildId), member(guildId)];
    for (const v of voters) await engagement.votePoll(v, anon.id, [anon.options[0]!.id]);

    const res = await engagement.getPollResults(manager, anon.id, { includeVoters: true });
    expect(res.options[0]!.votes).toBe(3);
    const list = await engagement.listPolls(manager, {});
    const tally = await engagement.tallyPoll(testDb(), anon.id);
    for (const blob of [JSON.stringify(res), JSON.stringify(list), JSON.stringify(tally)]) {
      for (const v of voters) expect(blob).not.toContain(v.actor.userId);
    }

    const open = await makePoll(guildId, { anonymous: false });
    await engagement.votePoll(voters[0]!, open.id, [open.options[1]!.id]);
    const staffView = await engagement.getPollResults(manager, open.id, { includeVoters: true });
    expect(staffView.options[1]!.voterIds).toEqual([voters[0]!.actor.userId]);
    await expect(engagement.getPollResults(member(guildId), open.id, { includeVoters: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const memberView = await engagement.getPollResults(member(guildId), open.id);
    expect(JSON.stringify(memberView)).not.toContain(voters[0]!.actor.userId);
  });

  it('hides tallies from members while a non-live poll is open', async () => {
    const guildId = await freshGuild();
    const poll = await makePoll(guildId, { liveResults: false });
    await expect(engagement.getPollResults(member(guildId), poll.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies poll management without polls.manage', async () => {
    const guildId = await freshGuild();
    const poll = await makePoll(guildId);
    await expect(engagement.createPoll(member(guildId), { question: 'Hello there?', options: ['a', 'b'], durationMs: 60_000, channelId: CHANNEL })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(engagement.closePoll(member(guildId), poll.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(engagement.listPolls(member(guildId))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('engagement: suggestions', () => {
  async function setup() {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { suggestionChannelId: CHANNEL } });
    return guildId;
  }
  const idea = { title: 'Add a Singapore location', body: 'Players in Asia get high ping on the European servers, a Singapore node would help.' };

  it('submits with a ref, neutralises mentions and rejects near-duplicates with a reference', async () => {
    const guildId = await setup();
    const s = await engagement.submitSuggestion(member(guildId), { ...idea, body: `${idea.body} @everyone` });
    expect(s.ref).toBe('S-0001');
    // Stored as written (minus secrets); neutralised whenever the bot echoes it.
    expect(JSON.stringify(engagement.suggestionEmbed(s))).not.toMatch(/@everyone/);
    await expect(engagement.submitSuggestion(member(guildId), { title: 'Add Singapore location', body: 'Players in Asia get high ping on European servers; a Singapore node would help.' })).rejects.toThrow(/S-0001/);
  });

  it('rate limits submissions to 3 per hour', async () => {
    const guildId = await setup();
    const author = ctxAs(guildId, [], { deps: testDeps() });
    const topics = ['Minecraft modpack rotation', 'Weekly speedrun leaderboard', 'Server status widget', 'Merch store discount codes'];
    for (const t of topics.slice(0, 3)) await engagement.submitSuggestion(author, { title: t, body: `Please consider this idea about ${t.toLowerCase()} for the community.` });
    await expect(engagement.submitSuggestion(author, { title: topics[3]!, body: 'Another unrelated idea entirely about merchandise.' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('one vote per user; switching and toggling keep counters exact', async () => {
    const guildId = await setup();
    const s = await engagement.submitSuggestion(member(guildId), idea);
    const v = member(guildId);
    expect(await engagement.voteSuggestion(v, s.id, 1)).toMatchObject({ vote: 1, upvotes: 1, downvotes: 0 });
    expect(await engagement.voteSuggestion(v, s.id, -1)).toMatchObject({ vote: -1, upvotes: 0, downvotes: 1 });
    expect(await engagement.voteSuggestion(v, s.id, -1)).toMatchObject({ vote: 0, upvotes: 0, downvotes: 0 });
    await Promise.all(Array.from({ length: 6 }, () => engagement.voteSuggestion(member(guildId), s.id, 1)));
    const row = await testDb().suggestion.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.upvotes).toBe(await testDb().suggestionVote.count({ where: { suggestionId: s.id, value: 1 } }));
    expect(row.upvotes).toBe(6);
  });

  it('staff status changes are permission-checked, audited and DM the author', async () => {
    const guildId = await setup();
    const s1 = await engagement.submitSuggestion(member(guildId), idea);
    const s2 = await engagement.submitSuggestion(member(guildId), { title: 'Dark mode for the panel', body: 'A dark theme for the website would be easier on the eyes at night.' });
    await expect(engagement.setSuggestionStatus(member(guildId), s1.id, { status: 'PLANNED' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const staff = ctxAs(guildId, ['suggestions.manage']);
    const planned = await engagement.setSuggestionStatus(staff, s1.id, { status: 'PLANNED', response: 'On the roadmap for Q1.' });
    expect(planned.staffResponse).toBe('On the roadmap for Q1.');
    const dup = await engagement.setSuggestionStatus(staff, s2.id, { status: 'DUPLICATE', duplicateOf: 'S-0001' });
    expect(dup.duplicateOfId).toBe(s1.id);
    await expect(engagement.setSuggestionStatus(staff, s1.id, { status: 'DUPLICATE', duplicateOf: s1.ref })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await testDb().scheduledJob.count({ where: { guildId, dedupeKey: { startsWith: 'engagement.dm:suggestion.status:' } } })).toBe(2);
    expect(await testDb().securityAuditEvent.count({ where: { guildId, action: 'engagement.suggestion.status', result: 'SUCCESS' } })).toBe(2);

    await engagement.setSuggestionHidden(staff, s1.id, true, 'spam');
    await expect(engagement.getSuggestion(member(guildId), s1.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await engagement.listSuggestions(member(guildId), {})).items.map((x) => x.id)).not.toContain(s1.id);
  });
});

describe('engagement: giveaways', () => {
  async function makeGiveaway(guildId: string, extra: Partial<engagement.CreateGiveawayInput> = {}) {
    return engagement.createGiveaway(ctxAs(guildId, ['giveaways.manage']), { prize: 'Discord Nitro (1 month)', winnerCount: 2, durationMs: 3_600_000, channelId: CHANNEL, ...extra });
  }
  const oldMember = { roleIds: [] as string[], accountCreatedAt: new Date('2020-01-01'), joinedAt: new Date('2021-01-01') };

  it('prevents duplicate entries and enforces eligibility at entry time', async () => {
    const guildId = await freshGuild();
    const role = snowflake();
    const g = await makeGiveaway(guildId, { requiredRoleIds: [role], minAccountAgeDays: 30 });
    const m = member(guildId);
    await expect(engagement.enterGiveaway(m, g.id, oldMember)).rejects.toThrow(/roles/);
    await engagement.enterGiveaway(m, g.id, { ...oldMember, roleIds: [role] });
    await expect(engagement.enterGiveaway(m, g.id, { ...oldMember, roleIds: [role] })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(engagement.enterGiveaway(member(guildId), g.id, { roleIds: [role], accountCreatedAt: new Date(), joinedAt: new Date() })).rejects.toThrow(/account/);
    expect(await testDb().giveawayEntry.count({ where: { giveawayId: g.id } })).toBe(1);
    expect((await engagement.leaveGiveaway(m, g.id)).left).toBe(true);
    expect(await testDb().giveawayEntry.count({ where: { giveawayId: g.id } })).toBe(0);
  });

  it('ending twice (even concurrently) records exactly one INITIAL draw with a verifiable hash', async () => {
    const guildId = await freshGuild();
    const g = await makeGiveaway(guildId);
    const entrants = Array.from({ length: 5 }, () => member(guildId));
    for (const e of entrants) await engagement.enterGiveaway(e, g.id, oldMember);
    const staff = ctxAs(guildId, ['giveaways.manage']);
    const results = await Promise.allSettled([engagement.finishGiveaway(staff, g.id), engagement.finishGiveaway(staff, g.id)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const draws = await testDb().giveawayDraw.findMany({ where: { giveawayId: g.id } });
    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({ seq: 1, kind: 'INITIAL', entrantCount: 5, algorithm: 'crypto.randomInt-fisher-yates-v1' });
    expect(new Set(draws[0]!.winnerIds).size).toBe(2);
    expect(engagement.verifyDraw(draws[0]!, entrants.map((e) => e.actor.userId)).valid).toBe(true);
    await expect(engagement.endGiveaway(staff, g.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(engagement.enterGiveaway(member(guildId), g.id, oldMember)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('reroll requires a reason, records it, and excludes previous winners', async () => {
    const guildId = await freshGuild();
    const g = await makeGiveaway(guildId, { winnerCount: 1 });
    const entrants = Array.from({ length: 3 }, () => member(guildId));
    for (const e of entrants) await engagement.enterGiveaway(e, g.id, oldMember);
    const staff = ctxAs(guildId, ['giveaways.manage']);
    const { draw } = await engagement.endGiveaway(staff, g.id);

    await expect(engagement.rerollGiveaway(staff, g.id, { reason: '' })).rejects.toThrow();
    const r1 = await engagement.rerollGiveaway(staff, g.id, { reason: 'Winner did not respond in 48h' });
    expect(r1).toMatchObject({ seq: 2, kind: 'REROLL', reason: 'Winner did not respond in 48h', entrantCount: 2 });
    expect(r1.winnerIds).not.toContain(draw!.winnerIds[0]);
    const r2 = await engagement.rerollGiveaway(staff, g.id, { reason: 'Second winner also unreachable' });
    expect(new Set([...draw!.winnerIds, ...r1.winnerIds, ...r2.winnerIds]).size).toBe(3);
    await expect(engagement.rerollGiveaway(staff, g.id, { reason: 'Nobody left' })).rejects.toMatchObject({ code: 'CONFLICT' });

    const auditRow = await testDb().securityAuditEvent.findFirst({ where: { guildId, action: 'engagement.giveaway.reroll' }, orderBy: { createdAt: 'asc' } });
    expect((auditRow?.metadata as { reason?: string }).reason).toBe('Winner did not respond in 48h');
    const auditView = await engagement.getGiveawayAudit(staff, g.id);
    expect(auditView.draws.every((d) => d.verification.valid)).toBe(true);
  });

  it('fewer entrants than winners: all entrants win', async () => {
    const guildId = await freshGuild();
    const g = await makeGiveaway(guildId, { winnerCount: 5 });
    const e = member(guildId);
    await engagement.enterGiveaway(e, g.id, oldMember);
    const { draw } = await engagement.endGiveaway(ctxAs(guildId, ['giveaways.manage']), g.id);
    expect(draw!.winnerIds).toEqual([e.actor.userId]);
    expect(draw!.entrantCount).toBe(1);
  });

  it('denies giveaway management without giveaways.manage', async () => {
    const guildId = await freshGuild();
    const g = await makeGiveaway(guildId);
    await expect(engagement.createGiveaway(member(guildId), { prize: 'x', durationMs: 60_000, channelId: CHANNEL })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(engagement.endGiveaway(member(guildId), g.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(engagement.finishGiveaway(member(guildId), g.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(engagement.rerollGiveaway(member(guildId), g.id, { reason: 'because' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(engagement.cancelGiveaway(member(guildId), g.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await deniedCount(guildId)).toBe(5);
  });
});
