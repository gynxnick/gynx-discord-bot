import { describe, expect, it } from 'vitest';
import {
  emptyGiveawayDraft,
  failedChecks,
  giveawayDraftToPayload,
  rerollPayload,
  truncateHash,
  validateGiveawayDraft,
  validateReroll,
  type GiveawayDraft,
} from './giveaway-form';

const CH = '123456789012345678';
const draft = (patch: Partial<GiveawayDraft> = {}): GiveawayDraft => ({
  ...emptyGiveawayDraft(),
  prize: 'Steam key',
  endsAt: '2026-11-01T18:00',
  channelId: CH,
  ...patch,
});

describe('giveaway form', () => {
  it('validates fields', () => {
    expect(validateGiveawayDraft(draft())).toEqual({});
    expect(validateGiveawayDraft(draft({ prize: ' ' })).prize).toBeDefined();
    expect(validateGiveawayDraft(draft({ winnerCount: '0' })).winnerCount).toBeDefined();
    expect(validateGiveawayDraft(draft({ winnerCount: '21' })).winnerCount).toBeDefined();
    expect(validateGiveawayDraft(draft({ endsAt: '' })).endsAt).toBeDefined();
    expect(
      validateGiveawayDraft(draft({ requiredRoleIds: ['1', '2', '3', '4', '5', '6'] })).requiredRoleIds,
    ).toBeDefined();
    expect(validateGiveawayDraft(draft({ minAccountAgeDays: '-1' })).minAccountAgeDays).toBeDefined();
    expect(validateGiveawayDraft(draft({ minMemberDays: '1.5' })).minMemberDays).toBeDefined();
    expect(validateGiveawayDraft(draft({ channelId: 'abc' })).channelId).toBeDefined();
  });

  it('maps to the API payload', () => {
    expect(
      giveawayDraftToPayload(
        draft({
          description: ' ',
          winnerCount: '3',
          requiredRoleIds: [CH, CH],
          minAccountAgeDays: '',
          minMemberDays: '7',
        }),
      ),
    ).toEqual({
      prize: 'Steam key',
      description: null,
      winnerCount: 3,
      endsAt: '2026-11-01T18:00',
      requiredRoleIds: [CH],
      minAccountAgeDays: 0,
      minMemberDays: 7,
      channelId: CH,
    });
  });

  it('lists failed verification checks', () => {
    const ok = {
      hashMatches: true,
      countMatches: true,
      winnersAreEntrants: true,
      winnersDistinct: true,
      knownAlgorithm: true,
      valid: true,
    };
    expect(failedChecks(ok)).toEqual([]);
    const bad = failedChecks({ ...ok, hashMatches: false, winnersDistinct: false, valid: false });
    expect(bad).toHaveLength(2);
    expect(bad[0]).toMatch(/^hashMatches/);
    expect(bad[1]).toMatch(/^winnersDistinct/);
  });

  it('truncates hashes', () => {
    const h = 'a'.repeat(10) + 'b'.repeat(48) + 'c'.repeat(6);
    expect(truncateHash(h)).toBe(`${'a'.repeat(10)}…${'c'.repeat(6)}`);
    expect(truncateHash('short')).toBe('short');
  });

  it('requires a reroll reason and bounds count', () => {
    expect(validateReroll({ reason: 'no', count: '' }).reason).toBeDefined();
    expect(validateReroll({ reason: 'Winner never replied', count: '' })).toEqual({});
    expect(validateReroll({ reason: 'Winner never replied', count: '0' }).count).toBeDefined();
    expect(validateReroll({ reason: 'Winner never replied', count: '21' }).count).toBeDefined();
    expect(rerollPayload({ reason: ' Left server ', count: '' })).toEqual({ reason: 'Left server' });
    expect(rerollPayload({ reason: 'Left server', count: '2' })).toEqual({ reason: 'Left server', count: 2 });
  });
});
