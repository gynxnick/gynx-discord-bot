import { describe, expect, it } from 'vitest';
import {
  discordMessageUrl,
  draftToPayload,
  emptyDraft,
  humanizeMentions,
  intToHex,
  isCancellable,
  isDeletable,
  isDirty,
  isEditable,
  mentionContent,
  normalizeHex,
  previewColor,
  validateDraft,
  type AnnouncementDraft,
} from './announcement-utils';
import { templateErrors } from './template-utils';

const ROLE = '123456789012345678';
const base = (patch: Partial<AnnouncementDraft> = {}): AnnouncementDraft => ({
  ...emptyDraft('223456789012345678'),
  title: ' Hello ',
  body: ' Body ',
  ...patch,
});

describe('draftToPayload', () => {
  it('trims and nulls blank optional fields', () => {
    expect(draftToPayload(base())).toEqual({
      type: 'GENERAL',
      title: 'Hello',
      body: 'Body',
      imageUrl: null,
      color: null,
      channelId: '223456789012345678',
      mention: 'NONE',
      mentionRoleId: null,
    });
  });
  it('normalises colours and keeps the role only for ROLE mentions', () => {
    expect(draftToPayload(base({ color: '22d3ee', mention: 'ROLE', mentionRoleId: ROLE }))).toMatchObject({
      color: '#22D3EE',
      mentionRoleId: ROLE,
    });
    expect(draftToPayload(base({ mention: 'EVERYONE', mentionRoleId: ROLE })).mentionRoleId).toBeNull();
  });
});

describe('validateDraft', () => {
  it('accepts a valid draft', () => expect(validateDraft(base())).toEqual({}));
  it('reports missing and invalid fields with API paths', () => {
    const errs = validateDraft(
      base({
        title: ' ',
        body: '',
        imageUrl: 'http://x.test/a.png',
        color: 'blue',
        channelId: '',
        mention: 'ROLE',
      }),
    );
    expect(Object.keys(errs).sort()).toEqual([
      'body',
      'channelId',
      'color',
      'imageUrl',
      'mentionRoleId',
      'title',
    ]);
    expect(errs.imageUrl).toBe('Links must use https://');
  });
});

describe('isDirty', () => {
  it('is dirty when unsaved or changed, not for whitespace-only edits', () => {
    expect(isDirty(base(), null)).toBe(true);
    expect(isDirty(base(), base({ title: 'Hello' }))).toBe(false);
    expect(isDirty(base({ title: 'Other' }), base())).toBe(true);
  });
});

describe('status rules', () => {
  it('matches the service', () => {
    expect(['DRAFT', 'SCHEDULED', 'FAILED', 'CANCELLED'].every((s) => isEditable(s as never))).toBe(true);
    expect(isEditable('PUBLISHED')).toBe(false);
    expect(isEditable('PUBLISHING')).toBe(false);
    expect(isDeletable('SCHEDULED')).toBe(false);
    expect(isDeletable('FAILED')).toBe(true);
    expect(isCancellable('SCHEDULED')).toBe(true);
    expect(isCancellable('DRAFT')).toBe(false);
  });
});

describe('mentions', () => {
  it('builds the preview content line', () => {
    expect(mentionContent('NONE', null)).toBeNull();
    expect(mentionContent('EVERYONE', null)).toBe('@everyone');
    expect(mentionContent('HERE', null)).toBe('@here');
    expect(mentionContent('ROLE', ROLE)).toBe(`<@&${ROLE}>`);
  });
  it('replaces role mentions in warnings with names', () => {
    const w = `This will ping <@&${ROLE}> and notify everyone with that role.`;
    expect(humanizeMentions(w, (id) => (id === ROLE ? 'Beta' : undefined))).toBe(
      'This will ping @Beta and notify everyone with that role.',
    );
    expect(humanizeMentions(w, () => undefined)).toBe(
      'This will ping the selected role and notify everyone with that role.',
    );
  });
});

describe('discordMessageUrl', () => {
  it('links only with valid snowflakes', () => {
    expect(discordMessageUrl('111111111111111111', '222222222222222222', '333333333333333333')).toBe(
      'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333',
    );
    expect(discordMessageUrl('111111111111111111', '222222222222222222', null)).toBeNull();
    expect(discordMessageUrl('x', '222222222222222222', '333333333333333333')).toBeNull();
  });
});

describe('colours', () => {
  it('normalises hex and falls back to the type colour', () => {
    expect(normalizeHex('#abcdef')).toBe('#ABCDEF');
    expect(normalizeHex('abc')).toBeNull();
    expect(previewColor('', 'MAINTENANCE', { MAINTENANCE: '#F59E0B' })).toBe('#F59E0B');
    expect(previewColor('112233', 'MAINTENANCE', { MAINTENANCE: '#F59E0B' })).toBe('#112233');
    expect(previewColor('', 'GENERAL', {})).toBe('#22D3EE');
    expect(intToHex(0x22d3ee)).toBe('#22D3EE');
    expect(intToHex(255)).toBe('#0000FF');
    expect(intToHex(undefined)).toBeNull();
  });
});

describe('templateErrors', () => {
  it('validates required fields', () => {
    expect(templateErrors({ name: 'n', type: 'GENERAL', title: 't', body: 'b' })).toEqual({});
    expect(Object.keys(templateErrors({ name: ' ', type: 'GENERAL', title: '', body: '' })).sort()).toEqual([
      'body',
      'name',
      'title',
    ]);
    expect(templateErrors({ name: 'x'.repeat(65), type: 'GENERAL', title: 't', body: 'b' }).name).toBe(
      'At most 64 characters.',
    );
  });
});
