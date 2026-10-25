import { describe, expect, it } from 'vitest';
import type { Giveaway, GiveawayDraw, Suggestion } from '@gynx/database';
import { listTextDefinitions, runWithTextOverrides } from '../core/text';
import * as engagement from './index';

const suggestion = {
  id: 's1',
  ref: 'S-0007',
  title: 'More map rotations',
  body: 'Please add more maps to the weekly rotation.',
  status: 'PLANNED',
  hidden: false,
  upvotes: 3,
  downvotes: 1,
  authorId: '123456789012345678',
  staffResponse: null,
} as unknown as Suggestion;

const giveaway = {
  id: 'g1',
  prize: 'Nitro',
  winnerCount: 1,
} as unknown as Giveaway;

const draw = {
  kind: 'INITIAL',
  winnerIds: ['111111111111111111'],
  entrantCount: 5,
} as unknown as GiveawayDraw;

describe('engagement texts', () => {
  it('registers the engagement catalogue', () => {
    const defs = listTextDefinitions().filter((d) => d.namespace === 'engagement');
    expect(defs.length).toBeGreaterThan(150);
    expect(defs.map((d) => d.key)).toContain('engagement.winnerAnnouncement');
  });

  it('keeps today’s default wording', () => {
    expect(engagement.winnerAnnouncementContent(giveaway, draw)).toBe(
      '🎉 Congratulations <@111111111111111111>! You won **Nitro**.\nThe team will contact you about your prize.',
    );
    expect(engagement.suggestionStatusLabel('UNDER_REVIEW')).toBe('Under review');
  });

  it('resolves overrides at call time', () => {
    runWithTextOverrides(
      {
        'engagement.winnerAnnouncement': 'GG {winners}, enjoy {prize}!',
        'engagement.suggestionStatusPlanned': 'On the roadmap',
        'engagement.suggestionFieldVotes': 'Score',
      },
      () => {
        expect(engagement.winnerAnnouncementContent(giveaway, draw)).toBe(
          'GG <@111111111111111111>, enjoy Nitro!\nThe team will contact you about your prize.',
        );
        const embed = engagement.suggestionEmbed(suggestion);
        const status = embed.fields?.find((f) => f.name === 'Status');
        expect(status?.value).toBe('On the roadmap');
        expect(embed.fields?.some((f) => f.name === 'Score')).toBe(true);
        const menu = engagement.suggestionComponents(suggestion)[1]!.components[0] as {
          options: Array<{ label: string }>;
        };
        expect(menu.options.map((o) => o.label)).toContain('On the roadmap');
      },
    );
    // Outside the scope the defaults are back.
    expect(engagement.suggestionStatusLabel('PLANNED')).toBe('Planned');
  });

  it('applies overrides to service errors', () => {
    runWithTextOverrides({ 'engagement.pollSingleChoiceOnly': 'Just one, please.' }, () => {
      expect(() =>
        engagement.validatePollSelection({ multipleChoice: false, maxChoices: 1 }, ['a', 'b'], ['a', 'b']),
      ).toThrow('Just one, please.');
    });
  });
});
