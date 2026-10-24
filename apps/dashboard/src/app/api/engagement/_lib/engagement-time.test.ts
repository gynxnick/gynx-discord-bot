import { describe, expect, it } from 'vitest';
import { eventCreateBodySchema, eventDurationMinutes, eventUpdateBodySchema } from './events';
import { giveawayCreateBodySchema, giveawayDurationMs } from './giveaways';
import { getPollResults, pollResultsQuery } from './polls';

const issuePath = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { issues?: Array<{ path: string[] }> }).issues?.[0]?.path.join('.');
  }
  return undefined;
};

describe('engagement handler input conversion', () => {
  it('computes event duration from wall-clock start/end in the guild zone', () => {
    expect(eventDurationMinutes('2026-11-05T19:30', '2026-11-05T21:00', 'Europe/London')).toBe(90);
    // Across the US DST change (1 Nov 2026, 02:00 → 01:00) the wall-clock gap is 2h but real time is 3h.
    expect(eventDurationMinutes('2026-11-01T00:00', '2026-11-01T02:00', 'America/New_York')).toBe(180);
  });

  it('rejects end before/equal to start, too short and too long, on the end field', () => {
    expect(issuePath(() => eventDurationMinutes('2026-11-05T19:30', '2026-11-05T19:30', 'UTC'))).toBe('end');
    expect(issuePath(() => eventDurationMinutes('2026-11-05T19:30', '2026-11-05T18:00', 'UTC'))).toBe('end');
    expect(issuePath(() => eventDurationMinutes('2026-11-05T19:30', '2026-11-05T19:33', 'UTC'))).toBe('end');
    expect(issuePath(() => eventDurationMinutes('2026-11-01T19:30', '2026-11-09T19:30', 'UTC'))).toBe('end');
  });

  it('computes giveaway duration from now and enforces 1 min..30 days', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    expect(giveawayDurationMs('2026-10-24T13:00', 'UTC', now)).toBe(3_600_000);
    // Berlin is UTC+2 (CEST) on 24 Oct 2026: 15:00 local = 13:00 UTC.
    expect(giveawayDurationMs('2026-10-24 15:00', 'Europe/Berlin', now)).toBe(3_600_000);
    expect(issuePath(() => giveawayDurationMs('2026-10-24T12:00', 'UTC', now))).toBe('endsAt');
    expect(issuePath(() => giveawayDurationMs('2026-12-01T12:00', 'UTC', now))).toBe('endsAt');
  });

  it('parses request bodies', () => {
    expect(
      eventCreateBodySchema.safeParse({ title: 'Game night', description: 'Fun', start: '2026-11-05T19:30' })
        .success,
    ).toBe(true);
    expect(
      eventCreateBodySchema.safeParse({ title: 'Game night', description: 'Fun', start: 'tomorrow' }).success,
    ).toBe(false);
    expect(
      eventCreateBodySchema.safeParse({
        title: 'Game night',
        description: 'Fun',
        start: '2026-11-05T19:30',
        reminderMinutesBefore: [60, 60],
      }).success,
    ).toBe(false);
    expect(eventUpdateBodySchema.safeParse({ channelId: '123456789012345678' }).success).toBe(false);
    const g = giveawayCreateBodySchema.parse({
      prize: 'Key',
      endsAt: '2026-11-01T18:00',
      channelId: '123456789012345678',
    });
    expect(g).toMatchObject({ winnerCount: 1, requiredRoleIds: [], minAccountAgeDays: 0, minMemberDays: 0 });
    expect(
      giveawayCreateBodySchema.safeParse({
        prize: 'Key',
        endsAt: '2026-11-01T18:00',
        channelId: '123456789012345678',
        durationMs: 5,
      }).success,
    ).toBe(false);
  });

  it('coerces the voters query flag', () => {
    expect(pollResultsQuery.parse({ voters: 'true' }).voters).toBe(true);
    expect(pollResultsQuery.parse({ voters: '1' }).voters).toBe(true);
    expect(pollResultsQuery.parse({}).voters).toBeUndefined();
    expect(getPollResults.opts.permission).toBe('polls.manage');
  });
});
