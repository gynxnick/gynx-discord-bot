import { describe, expect, it } from 'vitest';
import { inputToWallClock, toZonedInput } from './datetime';
import { colorToCss, fillWelcomePlaceholders, tokenizeLine, unknownPlaceholders } from './embed-markdown';
import { addTags, durationMs, httpsProblem, intOrNull, linkErrors, matchesQuery } from './form-utils';
import { guideToPayload } from './guide-payload';
import { channelName, groupChannels, roleName } from './picker-utils';
import { selfRoleToPayload } from './self-role-payload';
import { statusPayload } from './suggestion-payload';
import { welcomeToDraft, welcomeToPayload, type WelcomeRecord } from './welcome-payload';

describe('picker utils', () => {
  const channels = [
    { id: '1', name: 'General', type: 4, parentId: null },
    { id: '2', name: 'chat', type: 0, parentId: '1' },
    { id: '3', name: 'voice', type: 2, parentId: '1' },
    { id: '4', name: 'news', type: 5, parentId: null },
    { id: '5', name: 'orphan', type: 0, parentId: '999' },
  ];
  it('groups postable channels under categories, uncategorised first', () => {
    const g = groupChannels(channels);
    expect(g.map((x) => x.label)).toEqual([null, 'General']);
    expect(g[0]!.channels.map((c) => c.name)).toEqual(['news', 'orphan']);
    expect(g[1]!.channels.map((c) => c.name)).toEqual(['chat']);
  });
  it('names channels and roles, falling back to the id', () => {
    expect(channelName(channels, '2')).toBe('#chat');
    expect(channelName(channels, '42')).toBe('42');
    expect(channelName(channels, null)).toBe('—');
    expect(roleName([{ id: '9', name: 'Gamer', position: 1, managed: false }], '9')).toBe('@Gamer');
  });
});

describe('embed markdown', () => {
  it('tokenizes bold, italic, code and mentions without HTML', () => {
    const t = tokenizeLine(
      'Hi **there** *you* `x` <@&123456789012345678> <#123456789012345678> @everyone <b>',
    );
    expect(t.filter((x) => x.kind !== 'text').map((x) => [x.kind, x.text])).toEqual([
      ['bold', 'there'],
      ['italic', 'you'],
      ['code', 'x'],
      ['mention', '@role'],
      ['mention', '#channel'],
      ['mention', '@everyone'],
    ]);
    expect(t[t.length - 1]).toEqual({ kind: 'text', text: ' <b>' });
  });
  it('resolves mention names when provided', () => {
    const t = tokenizeLine('<@&123456789012345678>', { role: () => 'Gamers' });
    expect(t).toEqual([{ kind: 'mention', text: '@Gamers' }]);
  });
  it('fills and validates welcome placeholders', () => {
    expect(fillWelcomePlaceholders('Hey {user}, welcome to {server}!', { user: '@A', server: 'GYNX' })).toBe(
      'Hey @A, welcome to GYNX!',
    );
    expect(unknownPlaceholders('{user} {nick} {server} {x}')).toEqual(['nick', 'x']);
  });
  it('accepts only 6-digit hex colours', () => {
    expect(colorToCss('22d3ee')).toBe('#22d3ee');
    expect(colorToCss('#zzzzzz')).toBe('#22D3EE');
    expect(colorToCss(null, '#000000')).toBe('#000000');
  });
});

describe('form utils', () => {
  it('adds bounded, de-duplicated lowercase tags', () => {
    expect(addTags(['a'], 'B, a ,c,,', { max: 3 })).toEqual(['a', 'b', 'c']);
    expect(addTags([], 'x'.repeat(50), { maxLength: 10 })).toEqual(['x'.repeat(10)]);
  });
  it('validates https links', () => {
    expect(httpsProblem('http://x.com')).toBe('Links must use https://');
    expect(httpsProblem('nope')).toBe('Not a valid URL.');
    expect(httpsProblem('https://gynx.gg/docs')).toBeNull();
    expect(linkErrors([{ label: '', url: 'http://a.b' }])).toEqual({
      'links.0.label': 'Add a label.',
      'links.0.url': 'Links must use https://',
    });
  });
  it('parses numbers and durations', () => {
    expect(intOrNull('')).toBeNull();
    expect(intOrNull('2.5')).toBeNull();
    expect(intOrNull('7')).toBe(7);
    expect(durationMs(2, 'hours')).toBe(7_200_000);
  });
  it('matches queries across strings and arrays', () => {
    expect(matchesQuery('bill', 'How to pay', 'x', ['billing'])).toBe(true);
    expect(matchesQuery('zzz', 'How to pay')).toBe(false);
    expect(matchesQuery(undefined, 'anything')).toBe(true);
  });
});

describe('payload mapping', () => {
  const record: WelcomeRecord = {
    enabled: true,
    channelId: null,
    title: 'Welcome',
    message: 'Hey {user}',
    rulesText: 'Be nice',
    requireRulesAck: true,
    verificationEnabled: false,
    verifiedRoleId: null,
    minAccountAgeDays: 0,
    raidJoinThreshold: 10,
    raidWindowSeconds: 60,
    raidAction: 'ALERT',
    docsUrl: null,
    supportUrl: 'https://help.gynx.gg',
    dmOnJoin: false,
  };
  it('round-trips the welcome config', () => {
    expect(welcomeToPayload(welcomeToDraft(record))).toEqual(record);
    const d = {
      ...welcomeToDraft(record),
      docsUrl: '  ',
      minAccountAgeDays: '7',
      channelId: '123456789012345678',
    };
    expect(welcomeToPayload(d)).toMatchObject({
      docsUrl: null,
      minAccountAgeDays: 7,
      channelId: '123456789012345678',
    });
  });
  it('maps self-role drafts (enabled only on create)', () => {
    const d = {
      roleId: ' 123456789012345678 ',
      label: ' Gamer ',
      description: '',
      emoji: '🎮',
      group: 'games' as const,
      enabled: false,
      sortOrder: 'x',
    };
    expect(selfRoleToPayload(d, true)).toEqual({
      roleId: '123456789012345678',
      label: 'Gamer',
      description: null,
      emoji: '🎮',
      group: 'games',
      sortOrder: 0,
      enabled: false,
    });
    expect(selfRoleToPayload(d, false)).not.toHaveProperty('enabled');
  });
  it('omits a blank guide slug and nulls a blank game', () => {
    const p = guideToPayload({
      title: 'T',
      slug: ' ',
      category: 'Setup',
      game: '',
      summary: 'S',
      url: 'https://x.y',
      published: true,
    });
    expect(p).not.toHaveProperty('slug');
    expect(p.game).toBeNull();
  });
  it('builds suggestion status payloads', () => {
    expect(statusPayload('PLANNED', '  ', 'S-1')).toEqual({ status: 'PLANNED' });
    expect(statusPayload('DUPLICATE', 'dup', ' S-0001 ')).toEqual({
      status: 'DUPLICATE',
      response: 'dup',
      duplicateOf: 'S-0001',
    });
  });
});

describe('datetime helpers', () => {
  it('formats a UTC instant as guild wall-clock input', () => {
    expect(toZonedInput(new Date('2026-07-01T12:30:00Z'), 'Europe/London')).toBe('2026-07-01T13:30');
    expect(toZonedInput(null, 'UTC')).toBe('');
    expect(inputToWallClock('2026-07-01T13:30')).toBe('2026-07-01 13:30');
  });
});
