import { describe, expect, it } from 'vitest';
import {
  AutomodHistory,
  decideAutomodAction,
  evaluateMessage,
  extractHosts,
  extractInviteCodes,
  normaliseForPhrases,
  suggestEscalation,
  type AutomodEngineConfig,
  type AutomodMessage,
  type HistoryEntry,
} from './automod-engine';

const NOW = new Date('2026-06-01T12:00:00Z');
const OLD = new Date('2020-01-01T00:00:00Z');

const cfg = (over: Partial<AutomodEngineConfig> = {}): AutomodEngineConfig => ({
  enabled: true,
  duplicateThreshold: 4,
  duplicateWindowSeconds: 30,
  maxMentions: 6,
  burstThreshold: 8,
  burstWindowSeconds: 10,
  blockInvites: true,
  allowedInviteCodes: [],
  blockedDomains: [],
  allowedDomains: [],
  blockedPhrases: [],
  phishingDetection: true,
  newAccountDays: 7,
  exemptRoleIds: [],
  exemptChannelIds: [],
  ...over,
});

const msg = (content: string, over: Partial<AutomodMessage> = {}): AutomodMessage => ({
  authorId: '111111111111111111',
  channelId: '222222222222222222',
  content,
  mentionCount: 0,
  roleIds: [],
  accountCreatedAt: OLD,
  memberJoinedAt: OLD,
  timestamp: NOW,
  ...over,
});

const hist = (content: string, n: number, secondsApart = 1): HistoryEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    content,
    channelId: '222222222222222222',
    timestamp: new Date(NOW.getTime() - (i + 1) * secondsApart * 1000),
  }));

describe('automod: false-positive avoidance', () => {
  it.each([
    'Check the docs at https://github.com/gynx/docs and https://www.minecraft.net/en-us',
    'the server is free this weekend',
    'free',
    'I got nitro from a friend, pretty nice',
    'join us on https://discord.com/channels/1/2/3',
    'discord.js is great, see https://discord.js.org',
    'use node.js and file.txt please',
    'my email is test@example.com',
    'gift ideas for my brother?',
  ])('does not flag normal message: %s', (content) => {
    expect(evaluateMessage(cfg(), msg(content), [])).toBeNull();
  });

  it('allows mentioning two users', () => {
    expect(evaluateMessage(cfg(), msg('<@1> <@2> gg', { mentionCount: 2 }), [])).toBeNull();
  });

  it('a single weak phishing signal is not enough for established accounts', () => {
    expect(evaluateMessage(cfg(), msg('free nitro https://example.com'), [])).toBeNull();
    expect(evaluateMessage(cfg(), msg('docs at https://discordjs.guide'), [])).toBeNull();
  });

  it('returns null when disabled', () => {
    expect(evaluateMessage(cfg({ enabled: false }), msg('https://dlscord.gift/abc'), [])).toBeNull();
  });
});

describe('automod: exemptions', () => {
  it('skips exempt channels and roles', () => {
    const c = cfg({ exemptChannelIds: ['999999999999999999'], exemptRoleIds: ['888888888888888888'] });
    expect(evaluateMessage(c, msg('discord.gg/abc123', { channelId: '999999999999999999' }), [])).toBeNull();
    expect(evaluateMessage(c, msg('discord.gg/abc123', { roleIds: ['888888888888888888'] }), [])).toBeNull();
    expect(evaluateMessage(c, msg('discord.gg/abc123'), [])?.rule).toBe('INVITE');
  });
});

describe('automod: INVITE', () => {
  it.each([
    'discord.gg/abc123',
    'https://discord.com/invite/abc123',
    'discordapp.com/invite/abc123',
    'discord . gg / abc123',
    'discord[.]gg/abc123',
  ])('detects %s', (content) => expect(evaluateMessage(cfg(), msg(content), [])?.rule).toBe('INVITE'));

  it('respects allowed codes', () => {
    expect(
      evaluateMessage(cfg({ allowedInviteCodes: ['gynx'] }), msg('join discord.gg/gynx'), []),
    ).toBeNull();
  });

  it('new accounts cannot post invites even when invites are allowed', () => {
    const c = cfg({ blockInvites: false });
    expect(evaluateMessage(c, msg('discord.gg/abc123'), [])).toBeNull();
    expect(
      evaluateMessage(
        c,
        msg('discord.gg/abc123', { accountCreatedAt: new Date(NOW.getTime() - 86_400_000) }),
        [],
      )?.rule,
    ).toBe('INVITE');
  });

  it('extracts codes', () => {
    expect(extractInviteCodes('a discord.gg/x1y2 and discord.com/invite/zz9')).toEqual(['x1y2', 'zz9']);
  });
});

describe('automod: BLOCKED_DOMAIN', () => {
  const c = cfg({ blockedDomains: ['badsite.com'], allowedDomains: ['ok.badsite.com'] });
  it.each([
    'see https://badsite.com/x',
    'see https://sub.badsite.com/x',
    'see hxxps://badsite[.]com/x',
    'see badsite.com.',
    'see BADSITE.COM',
    'see https://user:pw@badsite.com:8080/x',
    'see bad​site.com',
  ])('blocks %s', (content) => expect(evaluateMessage(c, msg(content), [])?.rule).toBe('BLOCKED_DOMAIN'));

  it('allows allow-listed subdomains and unrelated hosts', () => {
    expect(evaluateMessage(c, msg('https://ok.badsite.com/'), [])).toBeNull();
    expect(evaluateMessage(c, msg('https://notbadsite.com/'), [])).toBeNull();
  });

  it('extracts hosts with trailing dots and obfuscation', () => {
    expect(extractHosts('hxxp://evil[.]example.org/path and www.test.io.')).toEqual(
      expect.arrayContaining(['evil.example.org', 'www.test.io']),
    );
  });
});

describe('automod: PHISHING', () => {
  it.each([
    'https://dlscord.gift/abc',
    'https://discorcl.com/nitro',
    'https://steamcommunlty.com/tradeoffer/new',
    'https://stearncommunity.ru/id/x',
    'https://discord-nitro.com/claim',
    'https://free-nitro.xyz',
    'https://dis-cord.app/login',
    'https://xn--dscord-pvf.com/gift', // Cyrillic і lookalike (punycode)
    'https://dіscord.com/gift', // Cyrillic і inline
  ])('flags strong signal %s', (content) => {
    expect(evaluateMessage(cfg(), msg(content), [])?.rule).toBe('PHISHING');
  });

  it('flags two weak signals', () => {
    expect(
      evaluateMessage(cfg(), msg('Free nitro for everyone! claim your gift: https://nitro-drop.example'), [])
        ?.rule,
    ).toBe('PHISHING');
    expect(evaluateMessage(cfg(), msg('@everyone free nitro https://example.com/x'), [])?.rule).toBe(
      'PHISHING',
    );
  });

  it('new accounts need only one weak signal', () => {
    const young = { accountCreatedAt: new Date(NOW.getTime() - 3_600_000) };
    expect(evaluateMessage(cfg(), msg('free nitro https://example.com', young), [])?.rule).toBe('PHISHING');
  });

  it('official domains never count', () => {
    expect(evaluateMessage(cfg(), msg('free nitro https://discord.gift/abc'), [])).toBeNull();
    expect(evaluateMessage(cfg(), msg('https://steamcommunity.com/id/me'), [])).toBeNull();
  });

  it('can be disabled', () => {
    expect(
      evaluateMessage(cfg({ phishingDetection: false }), msg('https://dlscord.gift/abc'), []),
    ).toBeNull();
  });
});

describe('automod: MENTIONS', () => {
  it('flags more than maxMentions', () => {
    expect(evaluateMessage(cfg(), msg('hi', { mentionCount: 7 }), [])?.rule).toBe('MENTIONS');
    expect(evaluateMessage(cfg(), msg('hi', { mentionCount: 6 }), [])).toBeNull();
  });
  it('counts @everyone/@here attempts', () => {
    expect(
      evaluateMessage(cfg({ maxMentions: 2 }), msg('@everyone @here look', { mentionCount: 1 }), [])?.rule,
    ).toBe('MENTIONS');
  });
});

describe('automod: BLOCKED_PHRASE', () => {
  const c = cfg({ blockedPhrases: ['badword', 'very bad thing'] });
  it.each(['this is a BADWORD', 'b4dw0rd!', 'bädword', 'a very   bad-thing indeed'])('flags %s', (content) =>
    expect(evaluateMessage(c, msg(content), [])?.rule).toBe('BLOCKED_PHRASE'),
  );
  it('respects word boundaries', () => {
    expect(evaluateMessage(c, msg('notbadwords here'), [])).toBeNull();
  });
  it('normalises', () => {
    expect(normaliseForPhrases('H3LL0 W0rld!')).toBe(' hello world ');
  });
});

describe('automod: DUPLICATE and BURST', () => {
  it('flags the Nth identical normalised message in the window', () => {
    expect(evaluateMessage(cfg(), msg('Buy cheap stuff'), hist('buy cheap stuff', 2))).toBeNull();
    expect(evaluateMessage(cfg(), msg('Buy cheap stuff!!'), hist('buy cheap stuff', 3))?.rule).toBe(
      'DUPLICATE',
    );
  });
  it('ignores duplicates outside the window', () => {
    expect(evaluateMessage(cfg(), msg('Buy cheap stuff'), hist('buy cheap stuff', 3, 20))).toBeNull();
  });
  it('flags bursts', () => {
    const h = Array.from({ length: 7 }, (_, i) => ({
      content: `m${i}`,
      channelId: 'c',
      timestamp: new Date(NOW.getTime() - i * 500),
    }));
    expect(evaluateMessage(cfg(), msg('another one'), h)?.rule).toBe('BURST');
    expect(evaluateMessage(cfg(), msg('another one'), h.slice(0, 5))).toBeNull();
  });
});

describe('AutomodHistory', () => {
  it('is bounded per user, evicts idle users and caps tracked users', () => {
    const h = new AutomodHistory({ maxPerUser: 3, idleMs: 1000, maxUsers: 2 });
    for (let i = 0; i < 5; i++) h.push('u1', 'c', `msg ${i}`, new Date(NOW.getTime() + i));
    expect(h.get('u1', NOW).map((e) => e.content)).toEqual(['msg 2', 'msg 3', 'msg 4']);
    expect(h.get('u1', new Date(NOW.getTime() + 5000))).toEqual([]);
    h.push('a', 'c', 'x', NOW);
    h.push('b', 'c', 'x', NOW);
    h.push('c', 'c', 'x', NOW);
    expect(h.size).toBe(2);
    expect(h.get('a', NOW)).toEqual([]);
  });
});

describe('escalation', () => {
  const c = { warnAtStrikes: 2, timeoutAtStrikes: 4, timeoutMinutes: 30 };
  it('automod: delete → warn → timeout, never ban', () => {
    expect(decideAutomodAction(1, c).action).toBe('DELETE');
    expect(decideAutomodAction(2, c).action).toBe('WARN');
    expect(decideAutomodAction(3, c).action).toBe('WARN');
    expect(decideAutomodAction(4, c)).toEqual({ action: 'TIMEOUT', strikes: 4, durationMs: 30 * 60_000 });
    expect(decideAutomodAction(1000, c).action).toBe('TIMEOUT');
  });
  it('moderator suggestions scale with active warnings', () => {
    expect(suggestEscalation(0, c).action).toBe('WARN');
    expect(suggestEscalation(2, c).action).toBe('TIMEOUT');
    expect(suggestEscalation(4, c).action).toBe('KICK');
    expect(suggestEscalation(8, c).action).toBe('BAN_REVIEW');
  });
});
