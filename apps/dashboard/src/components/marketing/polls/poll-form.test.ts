import { describe, expect, it } from 'vitest';
import {
  addOption,
  emptyPollDraft,
  moveOption,
  pollDraftToPayload,
  pollDurationMs,
  removeOption,
  validatePollDraft,
  votePercent,
  wantsVoters,
  type PollDraft,
} from './poll-form';

const CH = '123456789012345678';
const draft = (patch: Partial<PollDraft> = {}): PollDraft => ({
  ...emptyPollDraft(),
  question: 'Which map next?',
  options: ['Dust', 'Mirage', 'Inferno'],
  channelId: CH,
  ...patch,
});

describe('poll form', () => {
  it('edits options within 2..10 and reorders', () => {
    expect(addOption(['a', 'b'])).toEqual(['a', 'b', '']);
    expect(addOption(Array.from({ length: 10 }, (_, i) => String(i)))).toHaveLength(10);
    expect(removeOption(['a', 'b'], 0)).toEqual(['a', 'b']);
    expect(removeOption(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    expect(moveOption(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveOption(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveOption(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveOption(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('computes durations', () => {
    expect(pollDurationMs('1', 'minutes')).toBe(60_000);
    expect(pollDurationMs('2', 'hours')).toBe(7_200_000);
    expect(pollDurationMs('14', 'days')).toBe(14 * 86_400_000);
    expect(Number.isNaN(pollDurationMs('', 'days'))).toBe(true);
  });

  it('validates question, options, max choices, duration and channel', () => {
    expect(validatePollDraft(draft())).toEqual({});
    expect(validatePollDraft(draft({ question: 'Hi' })).question).toBeDefined();
    expect(validatePollDraft(draft({ options: ['a', ''] }))['options.1']).toBeDefined();
    expect(validatePollDraft(draft({ options: ['Same', 'same'] })).options).toMatch(/different/);
    expect(validatePollDraft(draft({ multipleChoice: true, maxChoices: '4' })).maxChoices).toBeDefined();
    expect(validatePollDraft(draft({ multipleChoice: true, maxChoices: '3' }))).toEqual({});
    expect(validatePollDraft(draft({ multipleChoice: false, maxChoices: '9' }))).toEqual({});
    expect(validatePollDraft(draft({ durationAmount: '30', durationUnit: 'minutes' }))).toEqual({});
    expect(validatePollDraft(draft({ durationAmount: '0.5', durationUnit: 'minutes' })).durationMs).toMatch(
      /Minimum/,
    );
    expect(validatePollDraft(draft({ durationAmount: '15', durationUnit: 'days' })).durationMs).toMatch(
      /Maximum/,
    );
    expect(validatePollDraft(draft({ channelId: '' })).channelId).toBeDefined();
  });

  it('maps to the createPoll payload (maxChoices only for multi)', () => {
    expect(
      pollDraftToPayload(
        draft({ options: [' Dust ', 'Mirage'], durationAmount: '2', durationUnit: 'hours' }),
      ),
    ).toEqual({
      question: 'Which map next?',
      options: ['Dust', 'Mirage'],
      multipleChoice: false,
      durationMs: 7_200_000,
      anonymous: false,
      liveResults: true,
      channelId: CH,
    });
    expect(pollDraftToPayload(draft({ multipleChoice: false, maxChoices: '2' })).maxChoices).toBeUndefined();
    expect(pollDraftToPayload(draft({ multipleChoice: true, maxChoices: '2' })).maxChoices).toBe(2);
    expect(pollDraftToPayload(draft({ multipleChoice: true, maxChoices: '' })).maxChoices).toBeUndefined();
  });

  it('computes percentages of ballots', () => {
    expect(votePercent(0, 0)).toBe(0);
    expect(votePercent(1, 3)).toBe(33.3);
    expect(votePercent(3, 3)).toBe(100);
  });

  it('reads the voters toggle', () => {
    expect(wantsVoters('1')).toBe(true);
    expect(wantsVoters('true')).toBe(true);
    expect(wantsVoters(undefined)).toBe(false);
    expect(wantsVoters('0')).toBe(false);
  });
});
