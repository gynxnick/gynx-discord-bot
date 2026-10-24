import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { engagement } from '@gynx/services';
import { ctxAs, freshGuild, silentLog, snowflake, testDb, testDeps } from '../../../../tests/integration/helpers';
import { JobRunner } from '../framework/runner';
import { engagementJobs } from './engagement';


/** Deps with a controllable clock so scheduled jobs (ends, reminders, debounced edits) can be driven. */
function harness(guildId: string) {
  let clock = Date.now();
  const deps = testDeps({ now: () => new Date(clock) });
  const runner = new JobRunner({ deps, env: { DISCORD_GUILD_ID: guildId } as WorkerEnv, log: silentLog, workerId: 't' }, [engagementJobs]);
  // The integration DB is shared across files, so the runner may also execute jobs left by other
  // test files; every assertion is scoped to this test's own channel and users.
  const channel = snowflake();
  const d = deps.discord;
  return {
    deps,
    channel,
    sent: () => d.sent.filter((m) => m.channelId === channel),
    edits: () => d.edits.filter((m) => m.channelId === channel),
    dmsTo: (...ctxs: Array<{ actor: { userId: string } }>) => {
      const ids = new Set(ctxs.map((c) => c.actor.userId));
      return d.dms.filter((m) => ids.has(m.userId)).map((m) => m.userId);
    },
    advance: (ms: number) => {
      clock += ms;
    },
    /** Run jobs until none are due (fan-out jobs enqueue more jobs). */
    async drain() {
      for (let k = 0; k < 10; k++) if ((await runner.tick(new Date(clock))) === 0) break;
    },
  };
}

describe('engagement worker jobs', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('publishes a poll once, debounces live edits, and publishes final results exactly once', async () => {
    const guildId = await freshGuild();
    const h = harness(guildId);
    const poll = await engagement.createPoll(ctxAs(guildId, ['polls.manage'], { deps: h.deps }), {
      question: 'Pick the next event',
      options: ['Build contest', 'PvP night'],
      durationMs: 5 * 60_000,
      channelId: h.channel,
    });
    await h.drain();
    await h.drain();
    expect(h.sent()).toHaveLength(1);
    const stored = await testDb().poll.findUniqueOrThrow({ where: { id: poll.id } });
    expect(stored.messageId).not.toBeNull();

    for (let k = 0; k < 3; k++) await engagement.votePoll(ctxAs(guildId, [], { deps: h.deps }), poll.id, [poll.options[0]!.id]);
    h.advance(61_000);
    await h.drain();
    expect(h.edits()).toHaveLength(1); // three votes in one minute bucket → one edit

    h.advance(5 * 60_000);
    await h.drain();
    const closed = await testDb().poll.findUniqueOrThrow({ where: { id: poll.id } });
    expect(closed.status).toBe('CLOSED');
    expect(closed.resultsPublishedAt).not.toBeNull();
    const finalEdit = h.edits().at(-1)!;
    expect(JSON.stringify(finalEdit.body)).toContain('Final results');
    expect(finalEdit.body.components).toEqual([]);

    // Running the end handler again is a no-op.
    const before = h.edits().length;
    await engagementJobs.handlers![engagement.JOBS.pollEnd]!({ payload: { pollId: poll.id } } as never, { deps: h.deps, env: {} as WorkerEnv, log: silentLog, workerId: 't' });
    expect(h.edits().length).toBe(before);
  });

  it('anonymous poll messages never contain voter ids', async () => {
    const guildId = await freshGuild();
    const h = harness(guildId);
    const poll = await engagement.createPoll(ctxAs(guildId, ['polls.manage'], { deps: h.deps }), {
      question: 'Anonymous feedback poll',
      options: ['Good', 'Bad'],
      durationMs: 60_000,
      anonymous: true,
      channelId: h.channel,
    });
    const voter = ctxAs(guildId, [], { deps: h.deps });
    await h.drain();
    await engagement.votePoll(voter, poll.id, [poll.options[1]!.id]);
    h.advance(2 * 60_000);
    await h.drain();
    const everything = JSON.stringify([h.sent(), h.edits()]);
    expect(h.sent()).toHaveLength(1);
    expect(everything).not.toContain(voter.actor.userId);
  });

  it('giveaway end job run twice draws once, and the announcement mentions only the winners', async () => {
    const guildId = await freshGuild();
    const h = harness(guildId);
    const g = await engagement.createGiveaway(ctxAs(guildId, ['giveaways.manage'], { deps: h.deps }), { prize: 'Server swag pack', winnerCount: 1, durationMs: 60_000, channelId: h.channel });
    const member = { roleIds: [], accountCreatedAt: new Date('2020-01-01'), joinedAt: new Date('2021-01-01') };
    const entrants = [ctxAs(guildId, [], { deps: h.deps }), ctxAs(guildId, [], { deps: h.deps })];
    for (const e of entrants) await engagement.enterGiveaway(e, g.id, member);
    await h.drain();

    h.advance(2 * 60_000);
    await h.drain();
    const w = { deps: h.deps, env: {} as WorkerEnv, log: silentLog, workerId: 't' };
    await engagementJobs.handlers![engagement.JOBS.giveawayEnd]!({ id: 'x', payload: { giveawayId: g.id } } as never, w);
    await h.drain();

    const draws = await testDb().giveawayDraw.findMany({ where: { giveawayId: g.id } });
    expect(draws).toHaveLength(1);
    expect(draws[0]!.kind).toBe('INITIAL');
    const announcement = h.sent().find((m) => typeof m.body.content === 'string' && m.body.content.includes('Congratulations'));
    expect(announcement?.body.allowed_mentions).toEqual({ parse: [], users: draws[0]!.winnerIds });
    expect(h.sent().filter((m) => m.body.content?.includes('Congratulations'))).toHaveLength(1);
  });

  it('event: publishes with RSVP buttons, and DMs reminders only to GOING attendees', async () => {
    const guildId = await freshGuild();
    const h = harness(guildId);
    const staff = ctxAs(guildId, ['events.manage'], { deps: h.deps });
    const start = new Date(Date.now() + 2 * 3_600_000);
    const wall = start.toISOString().slice(0, 16).replace('T', ' ');
    const ev = await engagement.createEvent(staff, { title: 'Patch notes stream', description: 'Live walkthrough of the update.', startsAt: wall, timezone: 'UTC', reminderMinutesBefore: [60], channelId: h.channel });
    const going = ctxAs(guildId, [], { deps: h.deps });
    const notGoing = ctxAs(guildId, [], { deps: h.deps });
    await engagement.rsvpEvent(going, ev.id, 'GOING');
    await engagement.rsvpEvent(notGoing, ev.id, 'NOT_GOING');
    await h.drain();
    expect(h.sent()).toHaveLength(1);
    expect(JSON.stringify(h.sent()[0]!.body.components)).toContain(`evt:rsvp:${ev.id}:go`);

    h.advance(61 * 60_000); // past the 60-minute reminder
    await h.drain();
    await h.drain();
    expect(h.dmsTo(going, notGoing)).toEqual([going.actor.userId]);
  });

  it('event cancel DMs attendees and edits the post; promotion DMs the promoted member', async () => {
    const guildId = await freshGuild();
    const h = harness(guildId);
    const staff = ctxAs(guildId, ['events.manage'], { deps: h.deps });
    const wall = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16).replace('T', ' ');
    const ev = await engagement.createEvent(staff, { title: 'Raid night', description: 'Bring snacks.', startsAt: wall, timezone: 'UTC', capacity: 1, channelId: h.channel });
    const a = ctxAs(guildId, [], { deps: h.deps });
    const b = ctxAs(guildId, [], { deps: h.deps });
    await engagement.rsvpEvent(a, ev.id, 'GOING');
    await engagement.rsvpEvent(b, ev.id, 'GOING'); // waitlist
    await h.drain();
    await engagement.rsvpEvent(a, ev.id, 'NOT_GOING');
    await h.drain();
    expect(h.dmsTo(a, b)).toEqual([b.actor.userId]);

    await engagement.cancelEvent(staff, ev.id);
    await h.drain();
    await h.drain();
    expect(h.dmsTo(a, b)).toEqual([b.actor.userId, b.actor.userId]);
    expect(JSON.stringify(h.edits().at(-1)!.body)).toContain('Cancelled');
  });

  it('suggestion: posts to the board, then DMs the author on status change', async () => {
    const guildId = await freshGuild();
    const h = harness(guildId);
    await testDb().guildConfig.update({ where: { guildId }, data: { suggestionChannelId: h.channel } });
    const author = ctxAs(guildId, [], { deps: h.deps });
    const s = await engagement.submitSuggestion(author, { title: 'Weekly patch digest', body: 'Post a weekly digest of game patches that affect our servers.' });
    await h.drain();
    expect(h.sent()).toHaveLength(1);
    await engagement.setSuggestionStatus(ctxAs(guildId, ['suggestions.manage'], { deps: h.deps }), s.id, { status: 'PLANNED', response: 'Great idea.' });
    await h.drain();
    expect(h.dmsTo(author)).toEqual([author.actor.userId]);
    expect(h.edits().length).toBeGreaterThanOrEqual(1);
  });
});
