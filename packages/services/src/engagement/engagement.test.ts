import { describe, expect, it } from 'vitest';
import { sha256 } from '@gynx/shared';
import { DRAW_ALGORITHM, drawWinners, entrantsHash, verifyDraw } from './draw';
import { decideRsvp, parseEventTime } from './events';
import { checkGiveawayEligibility } from './giveaways';
import { createPollSchema, splitPollOptions, validatePollSelection } from './polls';
import { SUGGESTION_SIMILARITY_THRESHOLD, findSimilarSuggestion, suggestionSimilarity } from './suggestions';

describe('poll vote validation', () => {
  const opts = ['a', 'b', 'c', 'd'];
  const single = { multipleChoice: false, maxChoices: 1 };
  const multi = { multipleChoice: true, maxChoices: 2 };

  it('single choice accepts exactly one option', () => {
    expect(validatePollSelection(single, opts, ['b'])).toEqual(['b']);
    expect(() => validatePollSelection(single, opts, ['a', 'b'])).toThrow(/only one/);
    expect(() => validatePollSelection(single, opts, [])).toThrow(/at least one/);
  });

  it('multiple choice accepts up to maxChoices distinct options', () => {
    expect(validatePollSelection(multi, opts, ['a', 'c'])).toEqual(['a', 'c']);
    expect(validatePollSelection(multi, opts, ['a', 'a'])).toEqual(['a']); // duplicates collapse
    expect(() => validatePollSelection(multi, opts, ['a', 'b', 'c'])).toThrow(/at most 2/);
  });

  it('rejects options from other polls', () => {
    expect(() => validatePollSelection(single, opts, ['zzz'])).toThrow(/not part of this poll/);
  });

  it('validates poll creation input', () => {
    const base = { question: 'Best map?', options: ['A', 'B'], durationMs: 3_600_000, channelId: '123456789012345678' };
    expect(createPollSchema.safeParse(base).success).toBe(true);
    expect(createPollSchema.safeParse({ ...base, options: ['A'] }).success).toBe(false);
    expect(createPollSchema.safeParse({ ...base, options: Array.from({ length: 11 }, (_, i) => `o${i}`) }).success).toBe(false);
    expect(createPollSchema.safeParse({ ...base, options: ['A', 'a'] }).success).toBe(false);
    expect(createPollSchema.safeParse({ ...base, multipleChoice: true, maxChoices: 3 }).success).toBe(false);
    expect(createPollSchema.safeParse({ ...base, maxChoices: 2 }).success).toBe(false); // single-choice
    expect(createPollSchema.safeParse({ ...base, durationMs: 30_000 }).success).toBe(false);
    expect(createPollSchema.safeParse({ ...base, durationMs: 15 * 86_400_000 }).success).toBe(false);
    expect(splitPollOptions(' Yes ; No;; Maybe ')).toEqual(['Yes', 'No', 'Maybe']);
  });
});

describe('event capacity / waitlist', () => {
  it('admits while there is room, then waitlists or rejects', () => {
    expect(decideRsvp(null, 999, false)).toBe('GOING');
    expect(decideRsvp(3, 2, true)).toBe('GOING');
    expect(decideRsvp(3, 3, true)).toBe('WAITLIST');
    expect(decideRsvp(3, 3, false)).toBe('FULL');
  });

  it('parses wall-clock times in the given zone', () => {
    expect(parseEventTime('2026-07-01 18:00', 'Europe/London').toISOString()).toBe('2026-07-01T17:00:00.000Z'); // BST
    expect(parseEventTime('2026-12-01 18:00', 'Europe/London').toISOString()).toBe('2026-12-01T18:00:00.000Z');
    expect(parseEventTime('2026-12-01 18:00', 'America/New_York').toISOString()).toBe('2026-12-01T23:00:00.000Z');
    expect(() => parseEventTime('2026-02-31 10:00', 'UTC')).toThrow(/does not exist/);
    expect(() => parseEventTime('tomorrow', 'UTC')).toThrow(/format/);
    expect(() => parseEventTime('2026-12-01 18:00', 'Mars/Olympus')).toThrow(/time zone/);
  });
});

describe('suggestion duplicate detection', () => {
  const existing = [
    { id: '1', ref: 'S-0001', title: 'Add a Valheim server location in Singapore', body: 'Players in Asia get high ping on the European Valheim servers.' },
    { id: '2', ref: 'S-0002', title: 'Dark mode for the website', body: 'The current bright theme is hard on the eyes at night.' },
  ];

  it('flags near-identical suggestions at or above the threshold', () => {
    const hit = findSimilarSuggestion(existing, { title: 'Add Valheim server location in Singapore', body: 'Asia players get high ping on European Valheim servers.' });
    expect(hit?.match.ref).toBe('S-0001');
    expect(hit!.score).toBeGreaterThanOrEqual(SUGGESTION_SIMILARITY_THRESHOLD);
  });

  it('does not flag unrelated suggestions', () => {
    expect(findSimilarSuggestion(existing, { title: 'Discord giveaway for Minecraft', body: 'Run a monthly community giveaway with free cosmetic ranks for members.' })).toBeNull();
  });

  it('threshold is inclusive and configurable', () => {
    const a = { title: 'alpha bravo charlie delta', body: '' };
    const b = { title: 'alpha bravo charlie echo', body: '' }; // 3 shared / 5 total = 0.6
    expect(suggestionSimilarity(a, b)).toBeCloseTo(0.6);
    expect(findSimilarSuggestion([{ id: 'x', ref: 'S-9', ...b }], a, 0.6)).not.toBeNull();
    expect(findSimilarSuggestion([{ id: 'x', ref: 'S-9', ...b }], a, 0.61)).toBeNull();
  });
});

describe('giveaway draw', () => {
  const entrants = ['300', '100', '500', '200', '400'];

  it('hash is deterministic and order-independent (sorted ids joined by comma)', () => {
    expect(entrantsHash(entrants)).toBe(entrantsHash([...entrants].reverse()));
    expect(entrantsHash(entrants)).toBe(sha256('100,200,300,400,500'));
  });

  it('draws distinct winners from the pool', () => {
    for (let k = 0; k < 50; k++) {
      const r = drawWinners(entrants, 3);
      expect(new Set(r.winnerIds).size).toBe(3);
      expect(r.winnerIds.every((w) => entrants.includes(w))).toBe(true);
      expect(r.algorithm).toBe(DRAW_ALGORITHM);
    }
  });

  it('is exactly reproducible with an injected rng', () => {
    // pool sorted: [100,200,300,400,500]; rng always 0 → Fisher–Yates keeps order.
    expect(drawWinners(entrants, 2, [], () => 0).winnerIds).toEqual(['100', '200']);
    // rng = max-1 → swap with the last element each step: i=0 ↔ 4 → 500; i=1 ↔ 4 (now 100) → 100
    expect(drawWinners(entrants, 2, [], (max) => max - 1).winnerIds).toEqual(['500', '100']);
  });

  it('reroll excludes previous winners and hashes the reduced pool', () => {
    const r = drawWinners(entrants, 10, ['100', '300']);
    expect(r.winnerIds.sort()).toEqual(['200', '400', '500']);
    expect(r.entrantCount).toBe(3);
    expect(r.entrantsHash).toBe(sha256('200,400,500'));
  });

  it('with fewer entrants than winners, everyone wins; with none, nobody', () => {
    expect(drawWinners(['1', '2'], 5).winnerIds.sort()).toEqual(['1', '2']);
    expect(drawWinners([], 3).winnerIds).toEqual([]);
  });

  it('verifyDraw recomputes the hash and checks winners', () => {
    const r = drawWinners(entrants, 2);
    expect(verifyDraw(r, entrants).valid).toBe(true);
    expect(verifyDraw(r, [...entrants, '600']).hashMatches).toBe(false);
    expect(verifyDraw({ ...r, winnerIds: ['999'] }, entrants).winnersAreEntrants).toBe(false);
    expect(verifyDraw({ ...r, winnerIds: ['100', '100'] }, entrants).winnersDistinct).toBe(false);
  });

  it('eligibility checks roles, account age and membership age', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const g = { requiredRoleIds: ['111'], minAccountAgeDays: 30, minMemberDays: 7 };
    const ok = { roleIds: ['111'], accountCreatedAt: new Date('2025-01-01'), joinedAt: new Date('2026-09-01') };
    expect(checkGiveawayEligibility(g, ok, now).eligible).toBe(true);
    expect(checkGiveawayEligibility(g, { ...ok, roleIds: [] }, now).reasons).toHaveLength(1);
    expect(checkGiveawayEligibility(g, { ...ok, accountCreatedAt: new Date('2026-09-25') }, now).eligible).toBe(false);
    expect(checkGiveawayEligibility(g, { ...ok, joinedAt: null }, now).eligible).toBe(false);
  });
});
