import { describe, expect, it } from 'vitest';
import { mentionPayload, mentionWarning, parseScheduleInput, renderAnnouncement } from './announcement-render';
import { detectReferralAbuse, diffInviteUses, snowflakeTimestamp } from './attribution';
import { publicHttpsUrlProblem, randomBase62, SLUG_RE } from './common';
import { privilegedDiscordPermissions } from './partners';

const base = { type: 'GENERAL' as const, title: 'Hello', body: 'Body with @everyone inside', imageUrl: null, color: null, mentionRoleId: null };

describe('announcement mentions', () => {
  it('NONE never pings anything', () => {
    expect(mentionPayload('NONE')).toEqual({ allowed_mentions: { parse: [] } });
    const body = renderAnnouncement({ ...base, mention: 'NONE' });
    expect(body.content).toBeUndefined();
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('EVERYONE allows exactly @everyone', () => {
    const body = renderAnnouncement({ ...base, mention: 'EVERYONE' });
    expect(body.content).toBe('@everyone');
    expect(body.allowed_mentions).toEqual({ parse: ['everyone'] });
  });

  it('HERE uses the everyone parse flag with @here content', () => {
    const body = renderAnnouncement({ ...base, mention: 'HERE' });
    expect(body.content).toBe('@here');
    expect(body.allowed_mentions).toEqual({ parse: ['everyone'] });
  });

  it('ROLE allows only that role', () => {
    const roleId = '123456789012345678';
    const body = renderAnnouncement({ ...base, mention: 'ROLE', mentionRoleId: roleId });
    expect(body.content).toBe(`<@&${roleId}>`);
    expect(body.allowed_mentions).toEqual({ parse: [], roles: [roleId] });
  });

  it('ROLE without a valid role id is rejected', () => {
    expect(() => mentionPayload('ROLE', null)).toThrow(/role/i);
    expect(() => mentionPayload('ROLE', 'abc')).toThrow(/role/i);
  });

  it('body text lives in the embed, content holds only the mention prefix', () => {
    const body = renderAnnouncement({ ...base, mention: 'NONE', color: '#7C3AED', imageUrl: 'https://cdn.example.com/x.png' });
    expect(body.embeds?.[0]?.description).toBe(base.body);
    expect(body.embeds?.[0]?.color).toBe(0x7c3aed);
    expect(body.embeds?.[0]?.image?.url).toBe('https://cdn.example.com/x.png');
  });

  it('warns only when someone is pinged', () => {
    expect(mentionWarning('NONE', null)).toBeNull();
    expect(mentionWarning('EVERYONE', null, { memberCount: 1234 })).toContain('1,234');
    expect(mentionWarning('ROLE', '123456789012345678', { roleMemberCount: 5 })).toContain('5 members');
    expect(mentionWarning('HERE', null)).toContain('@here');
  });
});

describe('schedule time-zone conversion', () => {
  it('converts wall time in a zone to UTC', () => {
    expect(parseScheduleInput('2026-07-01 18:30', 'Europe/London').toISOString()).toBe('2026-07-01T17:30:00.000Z'); // BST
    expect(parseScheduleInput('2026-12-01 18:30', 'Europe/London').toISOString()).toBe('2026-12-01T18:30:00.000Z'); // GMT
    expect(parseScheduleInput('2026-12-01 09:00', 'America/New_York').toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(parseScheduleInput('2026-12-01 09:00', 'UTC').toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });

  it('rejects bad formats, impossible dates, unknown zones and DST gaps', () => {
    expect(() => parseScheduleInput('tomorrow 5pm', 'UTC')).toThrow(/format/);
    expect(() => parseScheduleInput('2026-02-30 10:00', 'UTC')).toThrow(/does not exist/);
    expect(() => parseScheduleInput('2026-01-01 25:00', 'UTC')).toThrow();
    expect(() => parseScheduleInput('2026-01-01 10:00', 'Mars/Olympus')).toThrow(/time zone/);
    expect(() => parseScheduleInput('2026-03-29 01:30', 'Europe/London')).toThrow(/daylight/);
  });
});

describe('referral invite diff', () => {
  const before = new Map([
    ['aaa', 3],
    ['bbb', 0],
    ['ccc', 10],
  ]);

  it('exactly one invite changed → CONFIRMED', () => {
    const r = diffInviteUses(before, [
      { code: 'aaa', uses: 4 },
      { code: 'bbb', uses: 0 },
      { code: 'ccc', uses: 10 },
    ]);
    expect(r).toEqual({ confidence: 'CONFIRMED', inviteCode: 'aaa', changedCodes: ['aaa'] });
  });

  it('a brand-new invite with a use counts as changed', () => {
    expect(diffInviteUses(before, [{ code: 'new', uses: 1 }]).inviteCode).toBe('new');
  });

  it('several changed → AMBIGUOUS with no referrer', () => {
    const r = diffInviteUses(before, [
      { code: 'aaa', uses: 4 },
      { code: 'bbb', uses: 1 },
    ]);
    expect(r.confidence).toBe('AMBIGUOUS');
    expect(r.inviteCode).toBeNull();
  });

  it('none changed (vanity / vanished invite) → UNKNOWN', () => {
    expect(diffInviteUses(before, [{ code: 'aaa', uses: 3 }]).confidence).toBe('UNKNOWN');
    expect(diffInviteUses(before, []).confidence).toBe('UNKNOWN');
  });
});

describe('referral abuse detection', () => {
  const joinedAt = new Date('2026-10-01T12:00:00Z');
  const old = new Date('2024-01-01T00:00:00Z');
  const ok = { referrerId: '111111111111111111', joinedUserId: '222222222222222222', accountCreatedAt: old, joinedAt, previouslyAttributed: false, recentJoinsViaInvite: 0 };

  it('clean join has no flags', () => expect(detectReferralAbuse(ok)).toEqual([]));
  it('flags new accounts', () => expect(detectReferralAbuse({ ...ok, accountCreatedAt: new Date(joinedAt.getTime() - 3 * 86_400_000) })).toEqual(['NEW_ACCOUNT']));
  it('flags rejoins', () => expect(detectReferralAbuse({ ...ok, previouslyAttributed: true })).toEqual(['REJOIN']));
  it('flags self-referral', () => expect(detectReferralAbuse({ ...ok, joinedUserId: ok.referrerId })).toContain('SELF_REFERRAL'));
  it('flags bursts above the threshold', () => {
    expect(detectReferralAbuse({ ...ok, recentJoinsViaInvite: 4 })).toEqual([]); // 5th join = threshold, allowed
    expect(detectReferralAbuse({ ...ok, recentJoinsViaInvite: 5 })).toEqual(['BURST']);
  });
  it('decodes snowflake creation time', () => {
    expect(snowflakeTimestamp('175928847299117063').toISOString()).toBe('2016-04-30T11:18:25.796Z');
  });
});

describe('tracked link URL validation', () => {
  it('accepts public https URLs', () => {
    expect(publicHttpsUrlProblem('https://gynx.gg/pricing?utm=discord')).toBeNull();
    expect(publicHttpsUrlProblem('https://8.8.8.8/x')).toBeNull();
  });
  it.each([
    'http://gynx.gg',
    'javascript:alert(1)',
    'https://user:pass@gynx.gg',
    'https://localhost/admin',
    'https://127.0.0.1/',
    'https://10.0.0.5/',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/',
    'https://2130706433/',
    'https://printer.local/',
    'https://intranet/',
    'https://gynx.gg:8443/',
    'not a url',
  ])('rejects %s', (u) => expect(publicHttpsUrlProblem(u)).not.toBeNull());

  it('generates 8-char base62 slugs', () => {
    const s = new Set(Array.from({ length: 200 }, () => randomBase62(8)));
    expect(s.size).toBe(200);
    for (const slug of s) expect(slug).toMatch(SLUG_RE);
  });
});

describe('partner role safety', () => {
  it('detects privileged permission bits', () => {
    expect(privilegedDiscordPermissions('0')).toEqual([]);
    expect(privilegedDiscordPermissions(String(1n << 10n))).toEqual([]); // ViewChannel
    expect(privilegedDiscordPermissions(String(1n << 3n))).toEqual(['Administrator']);
    expect(privilegedDiscordPermissions(String((1n << 17n) | (1n << 13n)))).toEqual(expect.arrayContaining(['MentionEveryone', 'ManageMessages']));
    expect(privilegedDiscordPermissions('garbage')).toHaveLength(1);
  });
});
